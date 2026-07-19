# 그림일기 손글씨 폰트 적용 안내

## 폰트 파일

현재 사용하는 폰트는 `학교안심 꼬꼬마`입니다.

```text
public/fonts/HakgyoansimKkokkomaR.ttf
```

파일명이나 경로를 변경하면 `src/App.css`의 `@font-face` 경로도 동일하게 변경해야 합니다.

```css
@font-face {
  font-family: "HakgyoansimKkokkomaR";
  src: url("/fonts/HakgyoansimKkokkomaR.ttf") format("truetype");
}
```

## 폰트가 적용되는 부분

- 그림일기의 날짜와 요일
- 날씨
- 일기 제목
- 일기 본문
- 기기에 저장되는 그림일기 이미지의 날짜, 날씨, 제목, 본문

선생님 한줄평과 버튼 등 일반 UI에는 손글씨 폰트를 적용하지 않았습니다.

## 아이 손글씨 효과

6~8세 아이가 쓴 글씨처럼 너무 반듯하지 않게 각 글자에 작은 차이를 적용합니다.

날짜, 요일, 날씨, 제목은 `handwritingVariation()`의 기본값인
`strength: 1`을 사용합니다.

일기 본문도 `strength: 1`을 사용하므로 모든 영역에 같은 손글씨 변형 범위가 적용됩니다.

| 항목 | 적용 범위 |
| --- | --- |
| 글자 크기 | 90%~110% |
| 회전 | -7도~7도 |
| 좌우 위치 | 글자 크기 기준 약 -10%~10% |
| 상하 위치 | 글자 크기 기준 약 -14%~14% |
| 글자 굵기 | 600, 700, 900 중 하나 |
| 글자 농도 | 70%~100% |

손글씨 변형 범위는 날짜, 요일, 날씨, 제목, 본문이 같습니다.

다만 글자와 위치를 기준으로 각 값이 계산되므로, 각 글자에 실제로 적용되는
기울기, 위치, 크기, 굵기, 농도는 서로 다를 수 있습니다.

영역별 기본 글자 크기와 배치는 별도로 설정되어 있으므로,
모든 영역의 글자 크기가 화면에서 완전히 동일하게 표시되는 것은 아닙니다.

본문의 손글씨 강도는 `src/components/PreviewStep.tsx`와
`src/utils/diaryImage.ts`에서 `handwritingVariation()`의 세 번째 인자로
전달하는 값을 함께 변경해 조절합니다. 현재 값은 모두 `1`입니다.

굵기와 농도는 날짜, 요일, 날씨, 제목, 본문 모두에 적용됩니다.
`src/utils/handwriting.ts`의 `fontWeights`와 `opacity`에서 범위를 조절합니다.

현재 폰트는 Regular 한 종류이므로 600, 700, 900 굵기는
브라우저와 Canvas가 인위적으로 합성합니다.

무작위처럼 보이지만 글자와 위치를 기준으로 값을 고정합니다.
화면이 다시 렌더링되어도 글자가 움직이거나 흔들리지 않습니다.

## 변경한 파일

### `src/App.css`

- `@font-face`로 폰트 파일을 등록합니다.
- 날짜, 날씨, 제목, 본문에 `HakgyoansimKkokkomaR`을 적용합니다.
- `.handwritten-character`가 글자별 이동과 회전을 가능하게 합니다.

### `src/utils/handwriting.ts`

- 글자별 크기, 회전, 좌우 위치, 상하 위치를 계산합니다.
- 손글씨 효과를 강하거나 약하게 만들고 싶으면 이 파일의 `return` 값 범위를 조절합니다.

```ts
const rotationDeg = -7 + next() * 14;
const offsetXEm = -0.1 + next() * 0.2;
const offsetYEm = -0.14 + next() * 0.28;
const scale = 0.9 + next() * 0.2;
```

현재 회전 계산은 `-7도~7도`이므로 글자가 왼쪽과 오른쪽 양방향으로 기울어집니다.

날짜, 요일, 날씨, 제목은 기본 강도인 `strength: 1`을 사용하고,
본문도 `strength: 1`을 사용하므로 모든 영역에 `-7도~7도`의
회전 범위가 적용됩니다.

단, 글자와 위치에 따라 실제로 선택되는 회전값은 서로 다릅니다.

### `src/components/PreviewStep.tsx`

- 미리보기의 날짜, 날씨, 제목, 본문을 글자 단위로 나눕니다.
- `handwritingVariation()`이 계산한 스타일을 각 글자에 적용합니다.

### `src/utils/diaryImage.ts`

- Canvas로 저장하는 완성 이미지에도 동일한 폰트와 손글씨 효과를 적용합니다.
- 미리보기의 줄바꿈과 첨삭 표시 좌표가 달라지지 않도록 원래 글자 간격은 유지합니다.

## 폰트가 적용되지 않을 때

1. `public/fonts/HakgyoansimKkokkomaR.ttf` 파일이 존재하는지 확인합니다.
2. `App.css`의 `font-family` 이름이 모두 `HakgyoansimKkokkomaR`인지 확인합니다.
3. 개발 서버를 종료한 후 다시 실행합니다.

```powershell
npm.cmd run dev
```

4. 브라우저에서 강력 새로고침을 실행합니다.
