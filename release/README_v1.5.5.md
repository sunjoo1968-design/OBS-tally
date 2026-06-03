# OBS Tally v1.5.5 Release

Windows 실행용 vTally Hub + ESP8266 tally listener 패키지입니다.

## 실행 파일

- `vtally-web.exe`
- `firmware/ESP8266_vTally_Listener.bin`
- `firmware/esptool.exe`

`vtally-web.exe`를 실행한 뒤 브라우저에서 `http://localhost:3000/`으로 접속합니다.

## v1.5.5 변경 사항

- vMix Mix2 내부 PGM 소스가 Mix2가 메인 PGM/PVW에 없을 때도 tally로 반영되던 문제를 수정했습니다.
- Mix2 입력 자체가 vMix 메인 PGM에 있을 때만 Mix2 내부 PGM 소스를 적색으로 반영합니다.
- Mix2 입력 자체가 vMix 메인 PVW에 있을 때는 Mix2 내부 PGM 소스를 녹색으로 반영합니다.
- Mix2 입력이 메인 PGM/PVW 어디에도 없으면 Mix2 내부 PGM/PVW 소스를 tally 상태에 반영하지 않습니다.
- 웹 상단 버전 표기를 `V1.5.5`로 갱신했습니다.

## 검증

- Backend TypeScript build 통과
- vMix connector test 통과
- Frontend production build 통과
- `release/vtally-web.exe` 실행 후 `http://localhost:3000/` 응답 확인

## 참고

`wifi-tally.json`은 실행 파일과 같은 폴더에서 자동 생성/사용됩니다. 기존 설정을 유지하려면 릴리즈 파일 교체 시 `wifi-tally.json`은 덮어쓰지 마세요.
