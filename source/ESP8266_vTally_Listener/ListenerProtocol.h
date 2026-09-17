#ifndef VTALLY_LISTENER_PROTOCOL_H
#define VTALLY_LISTENER_PROTOCOL_H

#include <stdint.h>
#include <stddef.h>

namespace vtally {

struct Rgb { uint8_t r, g, b; };
struct TallyCommand {
  Rgb op, stage;
  uint8_t pattern;
  uint16_t duration;
};

inline bool whitespace(char c) { return c == ' ' || c == '\r' || c == '\n' || c == '\t'; }
inline bool decimal(const char *text, size_t length, uint32_t maximum, uint32_t &value) {
  if (length == 0) return false;
  uint32_t parsed = 0;
  for (size_t i = 0; i < length; i++) {
    if (text[i] < '0' || text[i] > '9') return false;
    const uint32_t digit = text[i] - '0';
    if (digit > maximum || parsed > (maximum - digit) / 10) return false;
    parsed = parsed * 10 + digit;
  }
  value = parsed;
  return true;
}
inline int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}
inline bool parseRgb(const char *text, Rgb &out) {
  uint32_t r, g, b;
  if (text[4] != '/' || text[8] != '/' || !decimal(text + 1, 3, 255, r) ||
      !decimal(text + 5, 3, 255, g) || !decimal(text + 9, 3, 255, b)) return false;
  out = {static_cast<uint8_t>(r), static_cast<uint8_t>(g), static_cast<uint8_t>(b)};
  return true;
}
inline bool parseCommand(const char *text, size_t length, TallyCommand &out) {
  while (length && whitespace(*text)) { text++; length--; }
  while (length && whitespace(text[length - 1])) length--;
  if (length < 25 || text[0] != 'O' || text[12] != ' ' || text[13] != 'S') return false;
  TallyCommand parsed = {};
  if (!parseRgb(text, parsed.op) || !parseRgb(text + 13, parsed.stage)) return false;
  if (length != 25) {
    if (length < 32 || length > 36 || text[25] != ' ' || text[26] != '0' ||
        text[27] != 'x' || text[30] != ' ') return false;
    const int high = hexDigit(text[28]), low = hexDigit(text[29]);
    uint32_t duration;
    if (high < 0 || low < 0 || !decimal(text + 31, length - 31, 65535, duration) || duration == 0) return false;
    parsed.pattern = static_cast<uint8_t>(high * 16 + low);
    parsed.duration = static_cast<uint16_t>(duration);
  }
  out = parsed;
  return true;
}
inline bool equal(Rgb a, Rgb b) { return a.r == b.r && a.g == b.g && a.b == b.b; }
inline bool equal(const TallyCommand &a, const TallyCommand &b) {
  return equal(a.op, b.op) && equal(a.stage, b.stage) && a.pattern == b.pattern && a.duration == b.duration;
}
inline bool black(Rgb c) { return c.r == 0 && c.g == 0 && c.b == 0; }
inline bool idle(const TallyCommand &command) {
  return command.pattern == 0 && black(command.stage) && command.op.r == 0 && command.op.b == 0 && command.op.g <= 1;
}
inline bool program(Rgb c) { return c.r > 0 && c.b == 0 && (c.g == 0 || c.r == c.g); }
inline bool preview(Rgb c) { return (c.g > 1 && c.r == 0 && c.b == 0) || (c.r > 0 && c.r == c.b && c.g == 0); }
inline bool advanceFlash(uint32_t now, uint16_t duration, uint32_t &timer, uint8_t &step) {
  if (duration == 0) return false;
  const uint32_t elapsed = now - timer;
  if (elapsed < duration) return false;
  const uint32_t steps = elapsed / duration;
  timer += steps * duration;
  step = static_cast<uint8_t>((step + steps) % 8);
  return true;
}
inline uint32_t crc32(const uint8_t *data, size_t length) {
  uint32_t crc = 0xFFFFFFFFUL;
  for (size_t i = 0; i < length; i++) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ (0xEDB88320UL & (0UL - (crc & 1)));
  }
  return ~crc;
}

}
#endif
