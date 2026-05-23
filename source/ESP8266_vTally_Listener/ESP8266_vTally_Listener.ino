#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <Wire.h>
#include <WiFiManager.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_NeoPixel.h>
#include <EEPROM.h>

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

struct Rgb {
  uint8_t r;
  uint8_t g;
  uint8_t b;
};

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
String lastCommand = "";

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

  if (config.magic != CONFIG_MAGIC) {
    setDefaultConfig();
  }
}

void saveConfig() {
  config.magic = CONFIG_MAGIC;
  EEPROM.put(0, config);
  EEPROM.commit();
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

  for (uint8_t i = 0; i < FRONT_LEDS; i++) {
    pixels.setPixelColor(i, offColor);
  }

  for (uint8_t i = FRONT_LEDS; i < TOTAL_LEDS; i++) {
    pixels.setPixelColor(i, idleColor);
  }

  pixels.show();
}

bool isBlack(Rgb color) {
  return color.r == 0 && color.g == 0 && color.b == 0;
}

bool isProgramColor(Rgb color) {
  return color.r > 5 && color.r > (color.g * 2) && color.r > (color.b * 2);
}

bool isPreviewColor(Rgb color) {
  return color.g > 5 && color.g > (color.r * 2) && color.g > (color.b * 2);
}

bool isProgramState() {
  return isProgramColor(stageColor) || isProgramColor(operatorColor);
}

bool isPreviewState() {
  return isPreviewColor(stageColor) || isPreviewColor(operatorColor);
}

bool isIdleState() {
  return !isProgramState() && !isPreviewState();
}

void applyTallyOutput() {
  if (isIdleState()) {
    showIdle();
    return;
  }

  if (flashPattern > 0 && flashStepDuration > 0) {
    bool on = (flashPattern & (0x80 >> flashStep)) != 0;
    if (on) {
      showColors(stageColor, operatorColor);
    } else {
      showOff();
    }
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

String stateLabel() {
  if (WiFi.status() != WL_CONNECTED) return "NO WIFI";
  if (!udpReady) return "NO UDP";
  if (!hubSeen) return "WAIT HUB";

  if (isProgramState()) return "PROGRAM";
  if (isPreviewState()) return "PREVIEW";
  if (isIdleState()) {
    return "IDLE";
  }
  return "IDLE";
}

void updateOLED() {
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
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(F("SETUP MODE"));
  display.println();
  display.println(F("SSID: TALLY-SETUP"));
  display.println(F("OPEN: 192.168.4.1"));
  display.println();
  display.println(F("Set Hub IP, port,"));
  display.println(F("and Tally Name."));
  display.display();
}

void showBootScreen() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(F("vTally Listener"));
  display.println(F("ESP8266 NodeMCU"));
  display.println();
  display.println(F("Booting..."));
  display.display();
}

void showButtonMessage(const __FlashStringHelper *line1, const __FlashStringHelper *line2) {
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
  if (millis() - buttonDisplayTimer < 250) return;
  buttonDisplayTimer = millis();

  uint8_t progress = min((unsigned long)100, (held * 100UL) / FACTORY_RESET_HOLD_MS);

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
  showButtonMessage(F("CONFIG PORTAL"), F("Opening AP..."));
  wifiManager.startConfigPortal(config.setupApName);
  updateOLED();
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

bool parseRgbAt(const String &text, int start, Rgb &out) {
  if (start < 0 || start + 12 > text.length()) return false;

  String r = text.substring(start + 1, start + 4);
  String g = text.substring(start + 5, start + 8);
  String b = text.substring(start + 9, start + 12);

  if (text.charAt(start + 4) != '/' || text.charAt(start + 8) != '/') return false;

  out.r = (uint8_t)constrain(r.toInt(), 0, 255);
  out.g = (uint8_t)constrain(g.toInt(), 0, 255);
  out.b = (uint8_t)constrain(b.toInt(), 0, 255);
  return true;
}

void parseFlash(const String &cmd) {
  flashPattern = 0;
  flashStepDuration = 0;
  flashStep = 0;

  int hexPos = cmd.indexOf("0x");
  if (hexPos < 0) return;

  String patternText = cmd.substring(hexPos + 2, hexPos + 4);
  char *endPtr = nullptr;
  flashPattern = (uint8_t)strtoul(patternText.c_str(), &endPtr, 16);

  String durationText = cmd.substring(hexPos + 4);
  durationText.trim();
  flashStepDuration = (uint16_t)durationText.toInt();
}

void handleHubCommand(const String &cmd) {
  Rgb newOperator = {0, 0, 0};
  Rgb newStage = {0, 0, 0};

  int opPos = cmd.indexOf('O');
  int stPos = cmd.indexOf('S');

  if (!parseRgbAt(cmd, opPos, newOperator)) return;
  if (!parseRgbAt(cmd, stPos, newStage)) return;

  operatorColor = newOperator;
  stageColor = newStage;
  parseFlash(cmd);

  hubSeen = true;
  lastHubPacketAt = millis();
  lastCommand = cmd;

  applyTallyOutput();
  updateOLED();
}

void sendRegistration() {
  if (WiFi.status() != WL_CONNECTED || strlen(config.hubIp) == 0) return;

  String msg = "tally-ho \"";
  msg += String(config.tallyName);
  msg += "\"";

  udp.beginPacket(config.hubIp, config.hubPort);
  udp.write((const uint8_t *)msg.c_str(), msg.length());
  udp.endPacket();
}

void pollUdp() {
  int packetSize = udp.parsePacket();
  if (packetSize <= 0) return;

  String packet;
  packet.reserve(packetSize);

  while (udp.available()) {
    packet += (char)udp.read();
  }

  packet.trim();
  if (packet.length() > 0) {
    Serial.print(F("hub: "));
    Serial.println(packet);
    handleHubCommand(packet);
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

  if (hubValue.length() > 0) copyString(config.hubIp, sizeof(config.hubIp), hubValue);
  if (portValue.toInt() > 0) config.hubPort = (uint16_t)portValue.toInt();
  if (nameValue.length() > 0) copyString(config.tallyName, sizeof(config.tallyName), nameValue);

  config.frontBrightness = clampBrightness(frontValue.toInt(), config.frontBrightness);
  config.rearBrightness = clampBrightness(rearValue.toInt(), config.rearBrightness);
  config.idleBrightness = clampBrightness(idleBrightnessValue.toInt(), config.idleBrightness);

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
  wifiManager.setSaveParamsCallback(updateConfigFromPortal);
  wifiManager.addParameter(&paramHubIp);
  wifiManager.addParameter(&paramHubPort);
  wifiManager.addParameter(&paramTallyName);
  wifiManager.addParameter(&paramFrontBrightness);
  wifiManager.addParameter(&paramRearBrightness);
  wifiManager.addParameter(&paramIdleBrightness);
  wifiManager.addParameter(&paramIdleColor);

  WiFi.mode(WIFI_STA);
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

  updateConfigFromPortal();
}

void setupUdp() {
  udpReady = udp.begin(LOCAL_UDP_PORT);
  if (udpReady) {
    Serial.print(F("UDP local port: "));
    Serial.println(LOCAL_UDP_PORT);
  } else {
    Serial.println(F("UDP begin failed"));
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(RESET_WIFI_BUTTON_PIN, INPUT_PULLUP);

  loadConfig();

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  display.clearDisplay();
  display.display();

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

  if (resetWifiButtonStart > 0) {
    delay(10);
    return;
  }

  if (udpReady) {
    pollUdp();
  }

  if (millis() - registerTimer > REGISTER_INTERVAL_MS) {
    registerTimer = millis();
    sendRegistration();
  }

  if (hubSeen && millis() - lastHubPacketAt > HUB_TIMEOUT_MS) {
    hubSeen = false;
    flashPattern = 0;
    flashStepDuration = 0;
    showIdle();
    updateOLED();
  }

  if (flashPattern > 0 && flashStepDuration > 0 && millis() - animationTimer > flashStepDuration) {
    animationTimer = millis();
    flashStep = (flashStep + 1) % 8;
    applyTallyOutput();
  }

  if (WiFi.status() != WL_CONNECTED || !udpReady || !hubSeen) {
    animateStatus();
  }

  if (millis() - oledTimer > 1000) {
    oledTimer = millis();
    updateOLED();
  }
}
