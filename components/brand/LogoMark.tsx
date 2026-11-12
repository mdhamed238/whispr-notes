/** The WhisprNotes logo (coral tile + folded note with waveform). */
import React from 'react';
import { SvgXml } from 'react-native-svg';

import { logoSvg } from '@/constants/logo';

export default function LogoMark({ size = 48 }: { size?: number }) {
  return <SvgXml xml={logoSvg(size)} width={size} height={size} accessibilityLabel="WhisprNotes" />;
}
