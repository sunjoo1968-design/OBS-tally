#define _CRT_SECURE_NO_WARNINGS
#include <assert.h>
#include "mocks/Hardware.h"
void invalidateHub();
#include "../ESP8266_vTally_Listener.ino"

static unsigned checks = 0;
static void check(bool value) { checks++; assert(value); }
static const char *red = "O255/000/000 S255/000/000";
static const char *white = "O255/255/255 S255/255/255 0xAA 125";
static void packet(const char *text) { handleHubCommand(text, strlen(text)); }
int main() {
  displayReady = true;
  loadConfig();
  check(config.hubPort == 7411 && !hubAddressValid);
  strcpy(config.hubIp, "192.168.1.5");
  strcpy(config.tallyName, "Cam01");
  config.frontBrightness = config.rearBrightness = 255;
  saveConfig();
  loadConfig();
  check(hubAddressValid && strcmp(config.tallyName, "Cam01") == 0);
  EEPROM.bytes[10] ^= 1;
  loadConfig();
  check(strcmp(config.tallyName, "Cam01") != 0);
  // Existing v1.5.8 Config layout, with no appended checksum, remains readable.
  strcpy(config.hubIp, "192.168.1.5");
  strcpy(config.tallyName, "Cam01");
  config.frontBrightness = config.rearBrightness = 255;
  EEPROM.put(0, config);
  memset(EEPROM.bytes + sizeof(Config), 255, sizeof(ConfigChecksum));
  loadConfig();
  check(strcmp(config.tallyName, "Cam01") == 0 && hubAddressValid);
  setupWifi();
  setupUdp();
  packet(red);
  check(hubSeen && pixels.colors[0] == 0xFF0000 && pixels.colors[8] == 0xFF0000);
  int writes = pixels.writes;
  int oledWrites = display.writes;
  for (unsigned i = 0; i < 10000; i++) { mockNow++; packet(red); }
  check(pixels.writes == writes && display.writes == oledWrites);
  packet(white);
  check(pixels.colors[0] == 0xFFFFFF && flashStep == 0 && strcmp(stateLabel(), "IDENTIFY") == 0);
  mockNow += 125; loop();
  check(flashStep == 1 && pixels.colors[0] == 0);
  packet(white);
  check(flashStep == 1 && pixels.colors[0] == 0);
  packet("O255/255/000 S255/255/000");
  check(pixels.colors[0] == 0xFFFF00 && strcmp(stateLabel(), "PROGRAM") == 0);
  packet("O255/000/255 S000/000/000");
  check(pixels.colors[8] == 0xFF00FF && strcmp(stateLabel(), "PREVIEW") == 0);
  uint32_t last = lastHubPacketAt;
  mockNow += 2000; packet("Oabc/000/000 S000/000/000");
  check(lastHubPacketAt == last);
  mockNow += 1001; loop();
  check(!hubSeen && flashPattern == 0 && pixels.colors[0] != 0xFF0000);
  udp.push(red, "192.168.1.6"); udp.push(red, "192.168.1.5", 9999);
  udp.push(std::string(65, 'x').c_str()); pollUdp();
  check(!hubSeen && udp.packets.empty());
  for (int i = 0; i < 9; i++) udp.push(red);
  pollUdp();
  check(udp.packets.size() == 1 && hubSeen);
  udp.packets.clear();
  WiFi.statusValue = 0; maintainNetwork();
  check(!hubSeen && !udpReady && pixels.colors[0] == 0 && pixels.colors[8] == 0);
  WiFi.statusValue = WL_CONNECTED; udp.bindSuccess = false; maintainNetwork();
  unsigned binds = udp.binds;
  mockNow += 999; maintainNetwork();
  check(!udpReady && udp.binds == binds);
  mockNow++; udp.bindSuccess = true; maintainNetwork();
  check(udpReady && udp.binds == binds + 1);
  packet(red); WiFi.ip = address("192.168.1.41"); maintainNetwork();
  check(udpReady && !hubSeen && wifiAddress == WiFi.ip && pixels.colors[0] == 0);
  packet(red); mockButton = LOW; loop();
  udp.push("O000/255/000 S000/000/000"); mockNow += 50; loop();
  check(hubSeen && pixels.colors[8] == 0x00FF00);
  mockNow += 4000; loop();
  check(!hubSeen);
  mockButton = HIGH; loop();
  check(wifiManager.active);
  packet(red); wifiManager.preSave();
  check(!hubSeen && !udpReady && pixels.colors[0] == 0);
  mockNow += 1; loop();
  check(udpReady && wifiManager.processCount > 0);
  paramHubPort.setValue("65536", 6); paramFrontBrightness.setValue("abc", 4);
  paramHubIp.setValue("bad.ip", 39); paramTallyName.setValue("bad\"name", 31);
  updateConfigFromPortal();
  check(config.hubPort == 7411 && config.frontBrightness == 255 && strcmp(config.hubIp, "192.168.1.5") == 0);
  check(strcmp(config.tallyName, "Cam01") == 0);
  paramHubPort.setValue("7415", 6); paramFrontBrightness.setValue("0", 4);
  paramHubIp.setValue("192.168.1.6", 39); paramTallyName.setValue("Cam02", 31);
  packet(red); updateConfigFromPortal();
  check(!hubSeen && config.hubPort == 7415 && config.frontBrightness == 0 && hubAddress == address("192.168.1.6"));
  loadConfig();
  check(strcmp(config.tallyName, "Cam02") == 0 && config.hubPort == 7415);
  EEPROM.bytes[sizeof(Config)] ^= 1;
  loadConfig();
  check(strcmp(config.tallyName, "Cam02") != 0);
  displayReady = false; oledWrites = display.writes; updateOLED();
  check(display.writes == oledWrites);
  mockNow = UINT32_MAX - 10;
  packet(white); mockNow += 125; loop();
  check(flashStep == 1 && pixels.colors[8] == 0);
  mockNow += 3001; loop();
  check(!hubSeen);
  printf("PASS: %u actual Arduino listener behavior assertions (mocked hardware)\n", checks);
}
