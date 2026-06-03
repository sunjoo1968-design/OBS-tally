# OBS Tally v1.5.0 Release

Windows 실행용 vTally Hub + ESP8266 tally listener 패키지입니다.

## 실행 파일

- `vtally-web.exe`
- `firmware/ESP8266_vTally_Listener.bin`
- `firmware/esptool.exe`

`vtally-web.exe`를 실행한 뒤 브라우저에서 `http://localhost:3000/`으로 접속합니다.

## v1.5.0 변경 사항

- vMix 선택 시 Mix2 내부 소스 전환 신호가 탈리 리스너에 늦게 반영되던 문제를 개선했습니다.
- vMix Mix 입력 상태 XML 조회 주기를 250ms로 조정했습니다.
- vMix `TALLY OK` 이벤트 직후 Mix 상태 XML을 재조회해 반응 시간을 줄였습니다.
- vMix TCP 응답을 버퍼링해 조각난 XML/명령을 안정적으로 처리합니다.
- vMix 재연결 시 새 socket을 생성하도록 바꿔 복구 안정성을 높였습니다.
- 웹 상단에 `made by SunjooAN`과 `V1.5.0` 표기를 추가했습니다.

## 검증

- Backend TypeScript build 통과
- vMix connector test 통과
- Frontend production build 통과
- `release/vtally-web.exe` 실행 후 `http://localhost:3000/` 응답 확인

## 참고

`wifi-tally.json`은 실행 파일과 같은 폴더에서 자동 생성/사용됩니다. 기존 설정을 유지하려면 릴리즈 파일 교체 시 `wifi-tally.json`은 덮어쓰지 마세요.
