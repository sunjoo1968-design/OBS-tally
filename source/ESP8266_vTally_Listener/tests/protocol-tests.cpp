#include "../ListenerProtocol.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <string>

static unsigned checks = 0;
static void check(bool value) { checks++; assert(value); }
static vtally::TallyCommand parse(const char *text) {
  vtally::TallyCommand command = {};
  check(vtally::parseCommand(text, strlen(text), command));
  return command;
}
int main() {
  using namespace vtally;
  auto pgm = parse("O255/000/000 S255/000/000");
  check(program(pgm.op) && !preview(pgm.op) && !idle(pgm));
  check(preview(parse("O000/255/000 S000/000/000").op));
  check(program(parse("O003/003/000 S003/003/000").stage));
  check(preview(parse("O003/000/003 S000/000/000").op));
  check(idle(parse("O000/001/000 S000/000/000")));
  check(idle(parse("O000/000/000 S000/000/000")));
  auto identify = parse(" \r\nO255/255/255 S255/255/255 0xAA 125\t ");
  check(identify.pattern == 0xAA && identify.duration == 125 && !idle(identify));
  check(!idle(parse("O000/000/128 S000/000/000 0x80 250")));
  check(parse("O255/255/255 S255/255/255 0xaa 65535").duration == 65535);
  check(parse("O000/000/001 S000/000/000 0x80 1").duration == 1);
  const char *invalid[] = {
    "", "O255/000/000", "O256/000/000 S000/000/000", "O000/999/000 S000/000/000",
    "O000/000/000 S000/000/256", "O00x/000/000 S000/000/000", "O-01/000/000 S000/000/000",
    "O255-000/000 S000/000/000", "O255/000/000 X000/000/000", "O255/000/000  S000/000/000",
    "O255/000/000 S000/000/000 extra", "O255/000/000 S000/000/000 0xGG 125",
    "O255/000/000 S000/000/000 0xA 125", "O255/000/000 S000/000/000 0xAA 0",
    "O255/000/000 S000/000/000 0xAA 65536", "O255/000/000 S000/000/000 0xAA -1",
    "O255/000/000 S000/000/000 0xAA 1a", "O255/000/000 S000/000/000 0xAA 100000",
  };
  for (auto text : invalid) {
    TallyCommand out = pgm;
    check(!parseCommand(text, strlen(text), out));
    check(equal(out, pgm));
  }
  const char *wire = "O255/255/255 S255/255/255 0xAA 125";
  for (size_t length = 0; length < 25; length++) {
    TallyCommand out;
    check(!parseCommand(wire, length, out));
  }
  std::string nul(wire); nul[7] = '\0';
  TallyCommand out;
  check(!parseCommand(nul.data(), nul.size(), out));
  uint32_t number = 11;
  check(!decimal("4294967296", 10, UINT32_MAX, number) && number == 11);
  check(decimal("4294967295", 10, UINT32_MAX, number) && number == UINT32_MAX);
  check(!decimal("1", 1, 0, number));
  uint32_t timer = 1000; uint8_t step = 0;
  check(!advanceFlash(1124, 125, timer, step) && timer == 1000 && step == 0);
  check(advanceFlash(1125, 125, timer, step) && step == 1);
  check(advanceFlash(2150, 125, timer, step) && step == 1 && timer == 2125);
  timer = UINT32_MAX - 49; step = 7;
  check(advanceFlash(50, 100, timer, step) && timer == 50 && step == 0);
  check(!advanceFlash(999, 0, timer, step));
  check(crc32(reinterpret_cast<const uint8_t *>("123456789"), 9) == 0xCBF43926UL);
  check(crc32(nullptr, 0) == 0);
  // Keep-alives must compare identically without changing the blink phase.
  for (unsigned i = 0; i < 10000; i++) check(equal(identify, parse(wire)));
  printf("PASS: %u protocol/color/flash/CRC assertions\n", checks);
}
