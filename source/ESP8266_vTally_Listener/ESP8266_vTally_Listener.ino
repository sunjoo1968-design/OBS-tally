#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <Wire.h>
#include <WiFiManager.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_NeoPixel.h>
#include <EEPROM.h>
#include "ListenerProtocol.h"

using vtally::Rgb;
using vtally::TallyCommand;

/*
  vTally UDP listener for NodeMCU Lua WiFi V3 ESP8266.

  Hardware, kept compatible with the referenced TallyArbiter listener:
  - Board: NodeMCU Lua WiFi V3 ESP8266
  - Front LEDs: WS2812 8 pixel ring, 5V
  - Operator LEDs: WS2812 8 pixel bar, 5V
  - NeoPixels are connected in one serial chain:
    NodeMCU D5 -> performer/front 8 pixel ring DIN,
    ring DOUT -> operator/rear 8 pixel bar DIN
  - Display: 0.96 inch SSD1306 I2C OLED, 128x64
  - Reset/config button: NodeMCU D3 to GND

  Arduino libraries:
  - ESP8266 board package
  - WiFiManager by tzapu
  - Adafruit GFX Library
  - Adafruit SSD1306
  - Adafruit NeoPixel

  Hub protocol:
  - The listener sends UDP: tally-ho "TALLY_NAME"
  - The hub replies with colors:
      O255/000/000 S000/255/000
      O255/255/255 S255/255/255 0xAA 125
    O = operator/rear bar, S = stage/front ring.
*/

#define OLED_WIDTH 128
#define OLED_HEIGHT 64
#define OLED_ADDR 0x3C
#define OLED_RESET -1

#define I2C_SDA_PIN D2
#define I2C_SCL_PIN D1

#define LED_PIN D5
#define FRONT_LEDS 8
#define REAR_LEDS 8
#define TOTAL_LEDS (FRONT_LEDS + REAR_LEDS)

#define RESET_WIFI_BUTTON_PIN D3
#define CONFIG_PORTAL_HOLD_MS 3000
#define FACTORY_RESET_HOLD_MS 10000

#define EEPROM_SIZE 512
#define CONFIG_MAGIC 0x5654414DUL

#define DEFAULT_HUB_PORT 7411
#define LOCAL_UDP_PORT 7412
#define REGISTER_INTERVAL_MS 500
#define HUB_TIMEOUT_MS 3000
#define VTALLY_FIRMWARE_VERSION "1.5.10"

struct Config {
  uint32_t magic;
  char wifiSsid[33];
  char wifiPassword[65];
  char setupApName[32];
  char hubIp[40];
  uint16_t hubPort;
  char tallyName[32];
  uint8_t frontBrightness;
  uint8_t rearBrightness;
  uint8_t idleBrightness;
  char idleColor[8];
};

const char FW_DEFAULT_WIFI_SSID[] = "VTALLY_WIFI_SSID_______________";
const char FW_DEFAULT_WIFI_PASSWORD[] = "VTALLY_WIFI_PASSWORD________________________________________________";
const char FW_DEFAULT_SETUP_AP[] = "VTALLY_SETUP_AP________________";
const char FW_DEFAULT_HUB_IP[] = "VTALLY_HUB_IP__________________________";
const char FW_DEFAULT_HUB_PORT[] = "VTALLY_HUB_PORT__";
const char FW_DEFAULT_TALLY_NAME[] = "VTALLY_TALLY_NAME______________";
const char FW_DEFAULT_FRONT_BRIGHTNESS[] = "VTALLY_FRONT_BRIGHTNESS__";
const char FW_DEFAULT_REAR_BRIGHTNESS[] = "VTALLY_REAR_BRIGHTNESS___";
const char FW_DEFAULT_IDLE_BRIGHTNESS[] = "VTALLY_IDLE_BRIGHTNESS___";
const char FW_DEFAULT_IDLE_COLOR[] = "VTALLY_IDLE_COLOR";

struct ConfigChecksum { uint32_t magic; uint32_t crc; };
const uint32_t checksumMagic = 0x56544343UL;
static_assert(sizeof(Config) + sizeof(ConfigChecksum) <= EEPROM_SIZE, "Config exceeds EEPROM");

Config config;

Adafruit_SSD1306 display(OLED_WIDTH, OLED_HEIGHT, &Wire, OLED_RESET);
Adafruit_NeoPixel pixels(TOTAL_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

WiFiManager wifiManager;
WiFiUDP udp;

WiFiManagerParameter paramHubIp("vt_hub", "vTally Hub IP", "", 39);
WiFiManagerParameter paramHubPort("vt_port", "vTally Tally Port", "", 6);
WiFiManagerParameter paramTallyName("vt_name", "Tally Name", "", 31);
WiFiManagerParameter paramFrontBrightness("vt_fbr", "Front Brightness 0-255", "", 4);
WiFiManagerParameter paramRearBrightness("vt_rbr", "Rear Brightness 0-255", "", 4);
WiFiManagerParameter paramIdleBrightness("vt_ibr", "Idle Brightness 0-255", "", 4);
WiFiManagerParameter paramIdleColor("vt_iclr", "Idle Color G/B/R/Y/W", "", 8);

bool shouldSaveConfig = false;
bool udpReady = false;
bool hubSeen = false;
bool displayReady = false;
bool oledDirty = true;
bool hubAddressValid = false;
IPAddress hubAddress;
IPAddress wifiAddress;
uint32_t udpRetryTimer = 0;
uint32_t flashTimer = 0;
uint32_t lastFrontColor = 0;
uint32_t lastRearColor = 0;
bool pixelsValid = false;

unsigned long registerTimer = 0;
unsigned long oledTimer = 0;
unsigned long animationTimer = 0;
unsigned long lastHubPacketAt = 0;
unsigned long resetWifiButtonStart = 0;
unsigned long buttonDisplayTimer = 0;

bool blinkState = false;
uint8_t flashPattern = 0;
uint16_t flashStepDuration = 0;
uint8_t flashStep = 0;

Rgb operatorColor = {0, 0, 0};
Rgb stageColor = {0, 0, 0};
TallyCommand lastCommand = {};

void copyString(char *dest, size_t destSize, const String &value) {
  value.toCharArray(dest, destSize);
  dest[destSize - 1] = '\0';
}

bool isFirmwarePlaceholder(const String &value) {
  return value.startsWith("VTALLY_");
}

String firmwareDefaultString(const char *value, const String &fallbackValue = "") {
  String text = String(value);
  text.trim();
  if (text.length() == 0 || isFirmwarePlaceholder(text)) return fallbackValue;
  return text;
}

uint16_t firmwareDefaultPort() {
  int value = firmwareDefaultString(FW_DEFAULT_HUB_PORT, String(DEFAULT_HUB_PORT)).toInt();
  if (value <= 0 || value > 65535) return DEFAULT_HUB_PORT;
  return (uint16_t)value;
}

uint8_t clampBrightness(int value, uint8_t fallbackValue) {
  if (value < 0) return fallbackValue;
  if (value > 255) return 255;
  return (uint8_t)value;
}

String defaultTallyName() {
  String name = "tally-";
  name += String(ESP.getChipId(), HEX);
  name.toUpperCase();
  return name;
}

void setDefaultConfig() {
  memset(&config, 0, sizeof(config));
  config.magic = CONFIG_MAGIC;
  copyString(config.wifiSsid, sizeof(config.wifiSsid), firmwareDefaultString(FW_DEFAULT_WIFI_SSID));
  copyString(config.wifiPassword, sizeof(config.wifiPassword), firmwareDefaultString(FW_DEFAULT_WIFI_PASSWORD));
  copyString(config.setupApName, sizeof(config.setupApName), firmwareDefaultString(FW_DEFAULT_SETUP_AP, "TALLY-SETUP"));
  copyString(config.hubIp, sizeof(config.hubIp), firmwareDefaultString(FW_DEFAULT_HUB_IP));
  config.hubPort = firmwareDefaultPort();

  String patchedName = firmwareDefaultString(FW_DEFAULT_TALLY_NAME);
  copyString(config.tallyName, sizeof(config.tallyName), patchedName.length() > 0 ? patchedName : defaultTallyName());

  config.frontBrightness = clampBrightness(firmwareDefaultString(FW_DEFAULT_FRONT_BRIGHTNESS, "128").toInt(), 128);
  config.rearBrightness = clampBrightness(firmwareDefaultString(FW_DEFAULT_REAR_BRIGHTNESS, "32").toInt(), 32);
  config.idleBrightness = clampBrightness(firmwareDefaultString(FW_DEFAULT_IDLE_BRIGHTNESS, "1").toInt(), 1);
  copyString(config.idleColor, sizeof(config.idleColor), firmwareDefaultString(FW_DEFAULT_IDLE_COLOR, "B"));
}

void loadConfig() {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.get(0, config);
  ConfigChecksum checksum = {};
  EEPROM.get(sizeof(Config), checksum);
  const bool validStrings =
    memchr(config.wifiSsid, 0, sizeof(config.wifiSsid)) &&
    memchr(config.wifiPassword, 0, sizeof(config.wifiPassword)) &&
    memchr(config.setupApName, 0, sizeof(config.setupApName)) &&
    memchr(config.hubIp, 0, sizeof(config.hubIp)) &&
    memchr(config.tallyName, 0, sizeof(config.tallyName)) &&
    memchr(config.idleColor, 0, sizeof(config.idleColor));
  const bool legacyChecksum = checksum.magic == 0xFFFFFFFFUL && checksum.crc == 0xFFFFFFFFUL;
  const bool checksumValid = legacyChecksum || (checksum.magic == checksumMagic &&
    checksum.crc == vtally::crc32(reinterpret_cast<const uint8_t *>(&config), sizeof(config)));
  IPAddress address;
  if (config.magic != CONFIG_MAGIC || !validStrings || !checksumValid || config.hubPort == 0 ||
      config.setupApName[0] == 0 || config.tallyName[0] == 0 ||
      strchr(config.tallyName, '"') || strchr(config.tallyName, '\r') || strchr(config.tallyName, '\n') ||
      (config.hubIp[0] != 0 && !address.fromString(config.hubIp))) {
    setDefaultConfig();
    Serial.println(F("Using firmware defaults (missing/invalid EEPROM config)"));
  }
  hubAddressValid = hubAddress.fromString(config.hubIp);
}

void saveConfig() {
  config.magic = CONFIG_MAGIC;
  EEPROM.put(0, config);
  const ConfigChecksum checksum = {checksumMagic, vtally::crc32(reinterpret_cast<const uint8_t *>(&config), sizeof(config))};
  EEPROM.put(sizeof(Config), checksum);
  if (!EEPROM.commit()) Serial.println(F("EEPROM commit failed"));
}

uint32_t scaledColor(Rgb color, uint8_t brightness) {
  return pixels.Color(
    ((uint16_t)color.r * brightness) / 255,
    ((uint16_t)color.g * brightness) / 255,
    ((uint16_t)color.b * brightness) / 255
  );
}

Rgb parseIdleColor() {
  String color = String(config.idleColor);
  color.trim();
  color.toUpperCase();

  if (color == "R" || color == "RED") return {255, 0, 0};
  if (color == "G" || color == "GREEN") return {0, 255, 0};
  if (color == "B" || color == "BLUE") return {0, 0, 255};
  if (color == "W" || color == "WHITE") return {255, 255, 255};
  return {255, 120, 0};
}

void showColors(Rgb stage, Rgb op) {
  uint32_t frontColor = scaledColor(stage, config.frontBrightness);
  uint32_t rearColor = scaledColor(op, config.rearBrightness);

  if (pixelsValid && frontColor == lastFrontColor && rearColor == lastRearColor) return;
  lastFrontColor = frontColor;
  lastRearColor = rearColor;
  pixelsValid = true;
  for (uint8_t i = 0; i < FRONT_LEDS; i++) {
    pixels.setPixelColor(i, frontColor);
  }

  for (uint8_t i = FRONT_LEDS; i < TOTAL_LEDS; i++) {
    pixels.setPixelColor(i, rearColor);
  }

  pixels.show();
}

void showOff() {
  showColors({0, 0, 0}, {0, 0, 0});
}

void showIdle() {
  uint32_t offColor = pixels.Color(0, 0, 0);
  uint32_t idleColor = scaledColor(parseIdleColor(), config.idleBrightness);
  if (pixelsValid && lastFrontColor == offColor && lastRearColor == idleColor) return;
  lastFrontColor = offColor;
  lastRearColor = idleColor;
  pixelsValid = true;

  for (uint8_t i = 0; i < FRONT_LEDS; i++) {
    pixels.setPixelColor(i, offColor);
  }

  for (uint8_t i = FRONT_LEDS; i < TOTAL_LEDS; i++) {
    pixels.setPixelColor(i, idleColor);
  }

  pixels.show();
}

bool isProgramColor(Rgb color) {
  return vtally::program(color);
}

bool isPreviewColor(Rgb color) {
  return vtally::preview(color);
}

bool isProgramState() {
  return isProgramColor(stageColor) || isProgramColor(operatorColor);
}

bool isPreviewState() {
  return isPreviewColor(stageColor) || isPreviewColor(operatorColor);
}

bool isIdleState() {
  return vtally::idle(lastCommand);
}

void applyTallyOutput() {
  if (flashPattern > 0 && flashStepDuration > 0) {
    bool on = (flashPattern & (0x80 >> flashStep)) != 0;
    if (on) {
      showColors(stageColor, operatorColor);
    } else {
      showOff();
    }
    return;
  }

  if (isIdleState()) {
    showIdle();
    return;
  }

  showColors(stageColor, operatorColor);
}

void saveConfigCallback() {
  shouldSaveConfig = true;
}

void drawWifiIcon(int16_t x, int16_t y) {
  int bars = 0;

  if (WiFi.status() == WL_CONNECTED) {
    int rssi = WiFi.RSSI();
    if (rssi > -55) bars = 4;
    else if (rssi > -67) bars = 3;
    else if (rssi > -78) bars = 2;
    else bars = 1;
  }

  for (uint8_t i = 0; i < 4; i++) {
    int16_t barX = x + (i * 4);
    int16_t barH = 2 + (i * 2);
    int16_t barY = y + 8 - barH;
    display.drawRect(barX, barY, 3, barH, SSD1306_WHITE);
    if (i < bars) {
      display.fillRect(barX + 1, barY + 1, 1, max(1, barH - 2), SSD1306_WHITE);
    }
  }
}

String shortTallyName() {
  String name = String(config.tallyName);
  name.trim();
  if (name.length() == 0) return "TALLY";
  if (name.length() > 12) name = name.substring(0, 12);
  return name;
}

const char *stateLabel() {
  if (WiFi.status() != WL_CONNECTED) return "NO WIFI";
  if (!udpReady) return "NO UDP";
  if (!hubSeen) return "WAIT HUB";
  if (flashPattern && operatorColor.r == operatorColor.g && operatorColor.g == operatorColor.b) return "IDENTIFY";
  if (flashPattern && operatorColor.r == 0 && operatorColor.g == 0 && operatorColor.b > 0) return "UNKNOWN";

  if (isProgramState()) return "PROGRAM";
  if (isPreviewState()) return "PREVIEW";
  if (isIdleState()) {
    return "IDLE";
  }
  return "COLOR";
}

void updateOLED() {
  oledDirty = false;
  oledTimer = millis();
  if (!displayReady) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);

  display.print(F("vTally UDP"));
  drawWifiIcon(110, 0);
  display.println();

  display.print(F("Name : "));
  display.println(shortTallyName());

  display.print(F("State: "));
  display.println(stateLabel());

  display.print(F("WiFi : "));
  display.println(WiFi.status() == WL_CONNECTED ? F("OK") : F("FAIL"));

  display.print(F("IP   : "));
  display.println(WiFi.localIP());

  display.print(F("Hub  : "));
  display.print(config.hubIp);
  display.print(F(":"));
  display.println(config.hubPort);

  display.print(F("Seen : "));
  display.println(hubSeen ? F("YES") : F("NO"));

  display.display();
}

void showSetupScreen() {
  if (!displayReady) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(F("SETUP MODE"));
  display.println();
  display.print(F("SSID: "));
  display.println(config.setupApName);
  display.println(F("OPEN: 192.168.4.1"));
  display.println();
  display.println(F("Set Hub IP, port,"));
  display.println(F("and Tally Name."));
  display.display();
}

void showBootScreen() {
  if (!displayReady) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(F("vTally Listener"));
  display.println(F("ESP8266 NodeMCU"));
  display.println(F("V" VTALLY_FIRMWARE_VERSION));
  display.println();
  display.println(F("Booting..."));
  display.display();
}

void showButtonMessage(const __FlashStringHelper *line1, const __FlashStringHelper *line2) {
  if (!displayReady) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(line1);
  display.println();
  display.println(line2);
  display.display();
  buttonDisplayTimer = millis();
}

void showButtonHoldStatus(unsigned long held) {
  if (!displayReady) return;
  if (millis() - buttonDisplayTimer < 250) return;
  buttonDisplayTimer = millis();

  uint8_t progress = static_cast<uint8_t>(min((unsigned long)100, (held * 100UL) / FACTORY_RESET_HOLD_MS));

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);

  display.println(F("BUTTON HOLD"));
  display.print(F("Time : "));
  display.print(held / 1000);
  display.print(F("."));
  display.print((held % 1000) / 100);
  display.println(F("s"));

  display.drawRect(0, 18, 100, 8, SSD1306_WHITE);
  display.fillRect(1, 19, progress - (progress > 0 ? 1 : 0), 6, SSD1306_WHITE);

  display.setCursor(0, 32);
  if (held >= FACTORY_RESET_HOLD_MS) {
    display.println(F("Release button:"));
    display.println(F("FACTORY RESET"));
  } else if (held >= CONFIG_PORTAL_HOLD_MS) {
    display.println(F("Release button:"));
    display.println(F("WIFI/HUB SETUP"));
    display.println(F("Hold 10s: RESET"));
  } else {
    display.println(F("Hold 3s : SETUP"));
    display.println(F("Hold 10s: RESET"));
  }

  display.display();
}

void factoryReset() {
  showButtonMessage(F("FACTORY RESET"), F("Restarting..."));
  wifiManager.resetSettings();
  setDefaultConfig();
  saveConfig();
  delay(500);
  ESP.restart();
}

void startConfigPortal() {
  if (wifiManager.getConfigPortalActive()) return;
  // Applying new WiFi settings can still block inside WiFiManager; do not freeze red.
  invalidateHub();
  showButtonMessage(F("CONFIG PORTAL"), F("Opening AP..."));
  wifiManager.setConfigPortalBlocking(false);
  wifiManager.startConfigPortal(config.setupApName);
  oledDirty = true;
}

void checkWifiResetButton() {
  bool pressed = digitalRead(RESET_WIFI_BUTTON_PIN) == LOW;

  if (pressed && resetWifiButtonStart == 0) {
    resetWifiButtonStart = millis();
    buttonDisplayTimer = 0;
    showButtonHoldStatus(0);
  } else if (pressed && resetWifiButtonStart > 0) {
    showButtonHoldStatus(millis() - resetWifiButtonStart);
  } else if (!pressed && resetWifiButtonStart > 0) {
    unsigned long held = millis() - resetWifiButtonStart;
    resetWifiButtonStart = 0;

    if (held >= FACTORY_RESET_HOLD_MS) {
      factoryReset();
    } else if (held >= CONFIG_PORTAL_HOLD_MS) {
      startConfigPortal();
    } else {
      updateOLED();
    }
  }
}

void animateStatus() {
  if (millis() - animationTimer < 350) return;
  animationTimer = millis();
  blinkState = !blinkState;

  if (WiFi.status() != WL_CONNECTED || !udpReady) {
    if (blinkState) showColors({0, 0, 20}, {0, 0, 20});
    else showOff();
  } else if (!hubSeen) {
    if (blinkState) showColors({20, 12, 0}, {20, 12, 0});
    else showOff();
  }
}

void handleHubCommand(const char *data, size_t length) {
  TallyCommand command;
  if (!vtally::parseCommand(data, length, command)) return;
  const bool changed = !hubSeen || !vtally::equal(lastCommand, command);
  hubSeen = true;
  lastHubPacketAt = millis();
  if (!changed) return;
  lastCommand = command;
  operatorColor = command.op;
  stageColor = command.stage;
  flashPattern = command.pattern;
  flashStepDuration = command.duration;
  flashStep = 0;
  flashTimer = millis();
  applyTallyOutput();
  oledDirty = true;
}

void sendRegistration() {
  if (!udpReady || WiFi.status() != WL_CONNECTED || !hubAddressValid) return;
  char msg[48];
  const int length = snprintf(msg, sizeof(msg), "tally-ho \"%s\"", config.tallyName);
  if (length <= 0 || length >= static_cast<int>(sizeof(msg))) return;
  if (!udp.beginPacket(hubAddress, config.hubPort)) return;
  udp.write(reinterpret_cast<const uint8_t *>(msg), length);
  if (!udp.endPacket()) Serial.println(F("Registration send failed"));
}

void pollUdp() {
  // Bound processing time and allocation even under malformed/foreign traffic.
  for (uint8_t count = 0; count < 8; count++) {
    const int size = udp.parsePacket();
    if (size <= 0) return;
    if (!hubAddressValid || udp.remoteIP() != hubAddress || udp.remotePort() != config.hubPort || size > 64) {
      udp.flush();
      continue;
    }
    char data[64];
    const int length = udp.read(reinterpret_cast<uint8_t *>(data), sizeof(data));
    if (length == size) handleHubCommand(data, length);
  }
}

void updateConfigFromPortal() {
  String hubValue = paramHubIp.getValue();
  String portValue = paramHubPort.getValue();
  String nameValue = paramTallyName.getValue();
  String frontValue = paramFrontBrightness.getValue();
  String rearValue = paramRearBrightness.getValue();
  String idleBrightnessValue = paramIdleBrightness.getValue();
  String idleColorValue = paramIdleColor.getValue();

  hubValue.trim();
  portValue.trim();
  nameValue.trim();
  frontValue.trim();
  rearValue.trim();
  idleBrightnessValue.trim();
  idleColorValue.trim();
  idleColorValue.toUpperCase();

  IPAddress parsedIp;
  const bool hubChanged = hubValue.length() > 0 && parsedIp.fromString(hubValue) && hubValue != config.hubIp;
  if (hubChanged) copyString(config.hubIp, sizeof(config.hubIp), hubValue);
  uint32_t parsed;
  const uint16_t previousPort = config.hubPort;
  if (vtally::decimal(portValue.c_str(), portValue.length(), 65535, parsed) && parsed > 0) config.hubPort = static_cast<uint16_t>(parsed);
  const bool nameChanged = nameValue.length() > 0 && nameValue.indexOf('"') < 0 && nameValue.indexOf('\r') < 0 && nameValue.indexOf('\n') < 0 && nameValue != config.tallyName;
  if (nameChanged) copyString(config.tallyName, sizeof(config.tallyName), nameValue);
  if (vtally::decimal(frontValue.c_str(), frontValue.length(), 255, parsed)) config.frontBrightness = static_cast<uint8_t>(parsed);
  if (vtally::decimal(rearValue.c_str(), rearValue.length(), 255, parsed)) config.rearBrightness = static_cast<uint8_t>(parsed);
  if (vtally::decimal(idleBrightnessValue.c_str(), idleBrightnessValue.length(), 255, parsed)) config.idleBrightness = static_cast<uint8_t>(parsed);

  if (
    idleColorValue == "R" || idleColorValue == "RED" ||
    idleColorValue == "G" || idleColorValue == "GREEN" ||
    idleColorValue == "B" || idleColorValue == "BLUE" ||
    idleColorValue == "Y" || idleColorValue == "YELLOW" ||
    idleColorValue == "W" || idleColorValue == "WHITE"
  ) {
    copyString(config.idleColor, sizeof(config.idleColor), idleColorValue);
  }

  saveConfig();
  hubAddressValid = hubAddress.fromString(config.hubIp);
  if (hubChanged || previousPort != config.hubPort || nameChanged) {
    invalidateHub();
    registerTimer = millis() - REGISTER_INTERVAL_MS;
  } else if (hubSeen) applyTallyOutput();
  oledDirty = true;

  Serial.print(F("Saved Hub: "));
  Serial.print(config.hubIp);
  Serial.print(F(":"));
  Serial.println(config.hubPort);
}

void setupWifi() {
  char portBuffer[8];
  char frontBuffer[5];
  char rearBuffer[5];
  char idleBrightnessBuffer[5];

  snprintf(portBuffer, sizeof(portBuffer), "%u", config.hubPort);
  snprintf(frontBuffer, sizeof(frontBuffer), "%u", config.frontBrightness);
  snprintf(rearBuffer, sizeof(rearBuffer), "%u", config.rearBrightness);
  snprintf(idleBrightnessBuffer, sizeof(idleBrightnessBuffer), "%u", config.idleBrightness);

  paramHubIp.setValue(config.hubIp, 39);
  paramHubPort.setValue(portBuffer, 6);
  paramTallyName.setValue(config.tallyName, 31);
  paramFrontBrightness.setValue(frontBuffer, 4);
  paramRearBrightness.setValue(rearBuffer, 4);
  paramIdleBrightness.setValue(idleBrightnessBuffer, 4);
  paramIdleColor.setValue(config.idleColor, 8);

  wifiManager.setSaveConfigCallback(saveConfigCallback);
  wifiManager.setPreSaveConfigCallback([]() {
    udp.stop();
    udpReady = false;
    invalidateHub();
    udpRetryTimer = millis() - 1000;
  });
  wifiManager.setConnectTimeout(10);
  wifiManager.setSaveConnectTimeout(10);
  wifiManager.setSaveParamsCallback(updateConfigFromPortal);
  wifiManager.addParameter(&paramHubIp);
  wifiManager.addParameter(&paramHubPort);
  wifiManager.addParameter(&paramTallyName);
  wifiManager.addParameter(&paramFrontBrightness);
  wifiManager.addParameter(&paramRearBrightness);
  wifiManager.addParameter(&paramIdleBrightness);
  wifiManager.addParameter(&paramIdleColor);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);

  wifiManager.setAPCallback([](WiFiManager *) {
    showSetupScreen();
  });

  bool connected = false;

  if (strlen(config.wifiSsid) > 0) {
    showButtonMessage(F("WIFI CONNECT"), F("Using saved setup..."));
    WiFi.begin(config.wifiSsid, config.wifiPassword);
    unsigned long wifiStart = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 20000) {
      delay(250);
    }
    connected = WiFi.status() == WL_CONNECTED;
  }

  if (!connected) {
    connected = wifiManager.autoConnect(config.setupApName);
  }

  if (!connected) {
    ESP.restart();
  }

  if (shouldSaveConfig) {
    copyString(config.wifiSsid, sizeof(config.wifiSsid), WiFi.SSID());
    copyString(config.wifiPassword, sizeof(config.wifiPassword), WiFi.psk());
    saveConfig();
    shouldSaveConfig = false;
  }
}

void setupUdp() {
  udpReady = udp.begin(LOCAL_UDP_PORT);
  if (udpReady) {
    wifiAddress = WiFi.localIP();
    registerTimer = millis() - REGISTER_INTERVAL_MS;
    Serial.print(F("UDP local port: "));
    Serial.println(LOCAL_UDP_PORT);
  } else {
    Serial.println(F("UDP begin failed"));
  }
}

void invalidateHub() {
  hubSeen = false;
  flashPattern = 0;
  flashStepDuration = 0;
  operatorColor = stageColor = {0, 0, 0};
  lastCommand = {};
  showOff();
  oledDirty = true;
}

void maintainNetwork() {
  const uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (udpReady || hubSeen) {
      udp.stop();
      udpReady = false;
      invalidateHub();
    }
    udpRetryTimer = now - 1000;
    return;
  }
  if (udpReady && WiFi.localIP() != wifiAddress) {
    udp.stop();
    udpReady = false;
    invalidateHub();
    udpRetryTimer = now - 1000;
  }
  if (!udpReady && now - udpRetryTimer >= 1000) {
    udpRetryTimer = now;
    setupUdp();
    oledDirty = true;
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(RESET_WIFI_BUTTON_PIN, INPUT_PULLUP);

  loadConfig();

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  displayReady = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (!displayReady) Serial.println(F("OLED allocation failed; continuing without display"));

  pixels.begin();
  showOff();

  showBootScreen();
  setupWifi();
  setupUdp();
  showIdle();
  updateOLED();
}

void loop() {
  checkWifiResetButton();
  if (wifiManager.getConfigPortalActive()) wifiManager.process();
  if (shouldSaveConfig && WiFi.status() == WL_CONNECTED) {
    copyString(config.wifiSsid, sizeof(config.wifiSsid), WiFi.SSID());
    copyString(config.wifiPassword, sizeof(config.wifiPassword), WiFi.psk());
    saveConfig();
    shouldSaveConfig = false;
  }
  maintainNetwork();

  if (udpReady) {
    pollUdp();
  }

  if (millis() - registerTimer >= REGISTER_INTERVAL_MS) {
    registerTimer = millis();
    sendRegistration();
  }

  if (hubSeen && millis() - lastHubPacketAt > HUB_TIMEOUT_MS) {
    invalidateHub();
  }

  if (hubSeen && flashPattern > 0 && vtally::advanceFlash(millis(), flashStepDuration, flashTimer, flashStep)) {
    applyTallyOutput();
  }

  if (WiFi.status() != WL_CONNECTED || !udpReady || !hubSeen) {
    animateStatus();
  }

  if (resetWifiButtonStart == 0 && !wifiManager.getConfigPortalActive() &&
      (millis() - oledTimer >= 1000 || (oledDirty && millis() - oledTimer >= 100))) {
    updateOLED();
  }
  delay(1);
}
