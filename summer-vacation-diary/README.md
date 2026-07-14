# summer-vacation-diary

Apps in Toss 프로젝트입니다.

## 시작하기

```bash
npm run dev
```

## 환경 변수 (선택)

일기 분석(선생님 한줄평·첨삭)은 OpenAI API로 동작합니다. 프로젝트 루트에
`.env` 파일을 만들고 아래 값을 채워주세요. **키가 없으면 자동으로 체험
모드(로컬 모의 분석)로 동작하므로, 개발 중에는 없어도 됩니다.**

```bash
# .env  (gitignored — 커밋되지 않아요)
VITE_OPENAI_API_KEY=sk-...
# 선택: 비전 모델 변경 (기본값 gpt-4o-mini)
VITE_OPENAI_MODEL=
```

> ⚠️ Vite의 `VITE_*` 변수는 빌드 시 클라이언트 번들에 그대로 포함됩니다.
> 로컬 개발과 챌린지 데모까지는 괜찮지만, 실제 공개 배포 전에는 OpenAI 호출을
> 자체 백엔드 프록시 뒤로 옮겨서 키가 노출되지 않게 해야 합니다.
> `.env`를 수정한 뒤에는 dev 서버를 재시작해야 반영됩니다.

## 배포하기

- 앱인토스 배포 API 키는 [앱인토스 콘솔](https://apps-in-toss.toss.im/) > 워크스페이스 > API 키 > 콘솔 API 키 에서 발급받을 수 있어요.

```bash
npm run build
npm run deploy
```

## 유용한 링크

- [앱인토스 콘솔](https://apps-in-toss.toss.im/)
- [앱인토스 개발자센터](https://developers-apps-in-toss.toss.im/)
- [앱인토스 개발자 커뮤니티](https://techchat-apps-in-toss.toss.im/)

AI를 사용하시는 경우 [여기](https://developers-apps-in-toss.toss.im/development/llms.html)를 확인해보세요.
