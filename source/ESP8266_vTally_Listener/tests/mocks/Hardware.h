#pragma once
#include <algorithm>
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <deque>
#include <vector>
#include <functional>
#include <sstream>

using std::min;
using std::max;
class __FlashStringHelper {};
#define F(text) reinterpret_cast<const __FlashStringHelper *>(text)
#define D1 5
#define D2 4
#define D3 0
#define D5 14
#define LOW 0
#define HIGH 1
#define INPUT_PULLUP 2
#define HEX 16
#define WL_CONNECTED 3
#define WIFI_STA 1
#define WIFI_NONE_SLEEP 0
#define SSD1306_WHITE 1
#define SSD1306_SWITCHCAPVCC 2
#define NEO_GRB 1
#define NEO_KHZ800 2
static uint32_t mockNow = 10000;
static int mockButton = HIGH;
inline unsigned long millis() { return mockNow; }
inline void delay(unsigned long time) { mockNow += time; }
inline void pinMode(int, int) {}
inline int digitalRead(int) { return mockButton; }

class String {
  std::string text;
public:
  String(const char *value = "") : text(value ? value : "") {}
  String(const std::string &value) : text(value) {}
  String(unsigned long value, int base = 10) {
    std::ostringstream stream;
    if (base == HEX) stream << std::hex;
    stream << value; text = stream.str();
  }
  String(int value) : text(std::to_string(value)) {}
  const char *c_str() const { return text.c_str(); }
  size_t length() const { return text.length(); }
  bool startsWith(const char *prefix) const { return text.find(prefix) == 0; }
  void trim() {
    size_t first = text.find_first_not_of(" \r\n\t"), last = text.find_last_not_of(" \r\n\t");
    text = first == std::string::npos ? "" : text.substr(first, last - first + 1);
  }
  void toUpperCase() { for (char &c : text) if (c >= 'a' && c <= 'z') c -= 'a' - 'A'; }
  void toCharArray(char *dest, size_t size) const { strncpy(dest, text.c_str(), size); dest[size - 1] = 0; }
  long toInt() const { return strtol(text.c_str(), nullptr, 10); }
  String substring(size_t first, size_t last) const { return String(text.substr(first, last - first)); }
  int indexOf(char c) const { size_t at = text.find(c); return at == std::string::npos ? -1 : static_cast<int>(at); }
  bool operator==(const char *other) const { return text == other; }
  bool operator!=(const char *other) const { return text != other; }
  String &operator+=(const String &other) { text += other.text; return *this; }
};
class IPAddress {
  uint32_t value = 0;
public:
  bool fromString(const char *text) {
    unsigned a, b, c, d; char suffix;
    if (sscanf(text, "%u.%u.%u.%u%c", &a, &b, &c, &d, &suffix) != 4 || a > 255 || b > 255 || c > 255 || d > 255) return false;
    value = (a << 24) | (b << 16) | (c << 8) | d; return true;
  }
  bool fromString(const String &text) { return fromString(text.c_str()); }
  bool operator==(const IPAddress &other) const { return value == other.value; }
  bool operator!=(const IPAddress &other) const { return value != other.value; }
};
static IPAddress address(const char *text) { IPAddress ip; ip.fromString(text); return ip; }
struct MockWifi {
  int statusValue = WL_CONNECTED;
  IPAddress ip = address("192.168.1.40");
  String ssid = "TestWifi", password = "TestPassword";
  int status() { return statusValue; }
  IPAddress localIP() { return ip; }
  int RSSI() { return -60; }
  void mode(int) {}
  void setAutoReconnect(bool) {}
  void setSleepMode(int) {}
  void begin(const char *name, const char *pass) { ssid = String(name); password = String(pass); }
  String SSID() { return ssid; }
  String psk() { return password; }
} WiFi;
struct MockSerial {
  void begin(int) {}
  template<typename T> void print(const T &) {}
  template<typename T> void println(const T &) {}
  void println() {}
} Serial;
struct MockEsp {
  unsigned long getChipId() { return 12345; }
  void restart() {}
} ESP;
struct MockWire { void begin(int, int) {} } Wire;
class Adafruit_SSD1306 {
public:
  int writes = 0;
  Adafruit_SSD1306(int, int, MockWire *, int) {}
  bool begin(int, int) { return true; }
  void clearDisplay() {}
  void setTextColor(int) {}
  void setTextSize(int) {}
  void setCursor(int, int) {}
  void drawRect(int, int, int, int, int) {}
  void fillRect(int, int, int, int, int) {}
  template<typename T> void print(const T &) {}
  template<typename T> void println(const T &) {}
  void println() {}
  void display() { writes++; }
};
class Adafruit_NeoPixel {
public:
  uint32_t colors[16] = {};
  int writes = 0;
  Adafruit_NeoPixel(int, int, int) {}
  void begin() {}
  uint32_t Color(unsigned r, unsigned g, unsigned b) { return (r << 16) | (g << 8) | b; }
  void setPixelColor(unsigned index, uint32_t color) { colors[index] = color; }
  void show() { writes++; }
};
struct MockEEPROM {
  uint8_t bytes[512];
  int commits = 0;
  MockEEPROM() { memset(bytes, 255, sizeof(bytes)); }
  void begin(int) {}
  template<typename T> void get(size_t at, T &out) { memcpy(&out, bytes + at, sizeof(T)); }
  template<typename T> void put(size_t at, const T &data) { memcpy(bytes + at, &data, sizeof(T)); }
  bool commit() { commits++; return true; }
} EEPROM;
class WiFiManagerParameter {
  String value;
public:
  WiFiManagerParameter(const char *, const char *, const char *initial, int) : value(initial) {}
  void setValue(const char *text, int) { value = String(text); }
  const char *getValue() { return value.c_str(); }
};
class WiFiManager {
public:
  bool active = false;
  int processCount = 0;
  std::function<void()> preSave;
  void setConfigPortalBlocking(bool) {}
  void startConfigPortal(const char *) { active = true; }
  bool getConfigPortalActive() { return active; }
  void process() { processCount++; }
  void resetSettings() {}
  void setSaveConfigCallback(std::function<void()>) {}
  void setPreSaveConfigCallback(std::function<void()> fn) { preSave = fn; }
  void setSaveParamsCallback(std::function<void()>) {}
  void setConnectTimeout(int) {}
  void setSaveConnectTimeout(int) {}
  void addParameter(WiFiManagerParameter *) {}
  void setAPCallback(std::function<void(WiFiManager *)>) {}
  bool autoConnect(const char *) { return true; }
};
class WiFiUDP {
public:
  struct Packet { std::string data; IPAddress ip; uint16_t port; };
  std::deque<Packet> packets;
  bool bindSuccess = true;
  bool bound = false;
  unsigned binds = 0, stops = 0, sends = 0, reads = 0;
  bool begin(int) { binds++; return bound = bindSuccess; }
  void stop() { bound = false; stops++; packets.clear(); }
  int parsePacket() { return packets.empty() ? 0 : static_cast<int>(packets.front().data.size()); }
  IPAddress remoteIP() { return packets.front().ip; }
  uint16_t remotePort() { return packets.front().port; }
  void flush() { if (!packets.empty()) packets.pop_front(); }
  int read(uint8_t *dest, size_t length) {
    auto packet = packets.front(); packets.pop_front(); reads++;
    size_t size = min(length, packet.data.size()); memcpy(dest, packet.data.data(), size);
    return static_cast<int>(size);
  }
  bool beginPacket(IPAddress, uint16_t) { return bound; }
  size_t write(const uint8_t *, size_t size) { return size; }
  bool endPacket() { sends++; return true; }
  void push(const char *text, const char *ip = "192.168.1.5", uint16_t port = 7411) {
    packets.push_back({std::string(text), address(ip), port});
  }
};
