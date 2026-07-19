export interface HandwritingVariation {
  /** Relative to the current font size, so preview CSS and export canvas match. */
  offsetXEm: number;
  offsetYEm: number;
  rotationDeg: number;
  scale: number;
  /** 단일 Regular 폰트에서는 브라우저가 굵기를 합성할 수 있습니다. */
  fontWeight: 600 | 700 | 900;
  /** 연필 압력처럼 보이는 글자별 농도입니다. */
  opacity: number;
}

// 글자와 위치로 고정된 값을 만들기 때문에 React가 다시 렌더링되어도
// 글자가 흔들리지 않습니다. 범위는 가독성을 해치지 않을 만큼만 작게 둡니다.
export function handwritingVariation(
  character: string,
  index: number,
  strength = 1,
): HandwritingVariation {
  let state = (character.codePointAt(0) ?? 0) ^ Math.imul(index + 1, 0x45d9f3b);

  const next = () => {
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
    state ^= state >>> 16;
    return (state >>> 0) / 0xffffffff;
  };

  const rotationDeg = -7 + next() * 14;
  const offsetXEm = -0.1 + next() * 0.2;
  const offsetYEm = -0.14 + next() * 0.28;
  const scale = 0.9 + next() * 0.2;
  // Regular 단일 폰트에서도 차이가 보이도록 단계 간격을 크게 둡니다.
  const fontWeights = [600, 700, 900] as const;
  const fontWeight = fontWeights[Math.floor(next() * fontWeights.length)];
  const opacity = 0.7 + next() * 0.3;

  // strength는 1을 기준으로 변형 폭만 키웁니다. scale도 1에서 떨어진
  // 거리만 확대하므로 글자가 한쪽으로 일괄 커지거나 작아지지 않습니다.
  return {
    rotationDeg: rotationDeg * strength,
    offsetXEm: offsetXEm * strength,
    offsetYEm: offsetYEm * strength,
    scale: 1 + (scale - 1) * strength,
    fontWeight,
    opacity,
  };
}
