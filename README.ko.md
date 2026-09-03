# HTTP Runner

이미 가지고 있는 `.http` 파일을 그대로 실행하고, 테스트하고, 감시합니다.

REST Client 로 쓰던 파일을 한 글자도 고치지 않습니다. 옮겨오라고 하지 않습니다.

## 무엇이 다른가

**테스트를 한 줄도 쓰지 않습니다.** 요청을 처음 보내면 그 응답이 정답으로 기록됩니다.
다음부터는 달라진 곳만 알려줍니다.

값이 아니라 **구조**를 봅니다. id 가 매번 바뀌고 토큰이 매번 새로 나와도 조용합니다.
필드가 사라지거나, 타입이 바뀌거나, 상태 코드가 달라질 때만 말합니다.

```
v 로그인해서 토큰 받기      200 5ms
x 토큰으로 내 정보 조회      500 9ms
      응답이 달라졌습니다 (5곳)
      status: 200 -> 500
      body.id: number -> string
      body.name: string -> (없음)
```

## 세 가지 쓰임

| | |
|---|---|
| **편집기** | 요청 위 `보내기` 를 누르면 응답이 옆에 열립니다 |
| **CI** | `httprunner ./api --reporter junit` 로 PR 을 막습니다 |
| **감시** | 일정 간격으로 돌려서 응답이 바뀌면 저장소에 이슈를 엽니다 |

감시는 **서버가 필요 없습니다.** 사용자의 GitHub Actions 안에서 돕니다.

```
httprunner init ./api --cron '*/30 * * * *'
```

## 이미 쓰던 것들이 그대로 됩니다

- `@name` 으로 요청 이름 붙이기, `{{login.response.body.$.token}}` 으로 토큰 이어받기
- `{{$guid}}` `{{$timestamp}}` `{{$randomInt}}` `{{$processEnv}}` `{{$dotenv}}`
- `< ./payload.json` 으로 본문을 파일에서
- `http-client.env.json` 과 `http-client.private.env.json` (IntelliJ 와 같은 형식)
- `.env`

## 값은 어디까지 무료인가

**요청을 하나씩 보내는 것은 계속 무료입니다.** 이건 뺏지 않습니다.

파일 전체 실행, 응답 기록과 비교, CI 연결, 감시가 유료입니다. 체험 14일.

그리고 이 두 가지는 지킵니다.

1. **이미 만든 것은 잠그지 않습니다.** `.http` 파일도 기록된 응답도 언제나 그대로 읽힙니다
2. **우리 서버가 죽어도 당신의 CI 는 돌아갑니다.** 라이선스 확인에 실패하면 그냥 통과시킵니다

## 명령

```
httprunner <파일 또는 폴더...> [옵션]

  --env <이름>       환경 이름
  --update           지금 응답을 정답으로 다시 기록
  --assert shape|exact|off
  --only <문자열>    제목이 일치하는 요청만
  --bail             첫 실패에서 중단
  --reporter pretty|json|junit
  --out <파일>
```

실패가 있으면 종료 코드 1 입니다.

## 개발

```
./build.sh        ext/core 로 엔진을 복사
node test/run.js  실제 서버를 띄워 처음부터 끝까지
node test/ext.js  확장 활성화와 CodeLens
```
