import { useResolvedTheme } from './useResolvedTheme';

export interface V3Tokens {
  fontSans: string;
  fontSerif: string;
  bg: string;
  surface: string;
  surfaceHover: string;
  card: string;
  dark: string;
  textMuted: string;
  border: string;
  borderLight: string;
}

const LIGHT: V3Tokens = {
  fontSans: '"Nunito Sans", -apple-system, BlinkMacSystemFont, sans-serif',
  fontSerif: '"Playfair Display", "Times New Roman", serif',
  bg: '#FDFDFA',
  surface: '#FDFDFA',
  surfaceHover: '#ECEAE4',
  card: '#F7F5F0',
  dark: '#1B1B1B',
  textMuted: 'rgba(27,27,27,0.6)',
  border: '#BFBFBF',
  borderLight: 'rgba(27,27,27,0.08)',
};

const DARK: V3Tokens = {
  fontSans: LIGHT.fontSans,
  fontSerif: LIGHT.fontSerif,
  bg: '#1B1B1B',
  surface: '#1B1B1B',
  surfaceHover: '#2A2A2A',
  card: '#242424',
  dark: '#FDFDFA',
  textMuted: 'rgba(253,253,250,0.55)',
  border: 'rgba(253,253,250,0.15)',
  borderLight: 'rgba(253,253,250,0.08)',
};

export function useV3Tokens(): V3Tokens {
  const theme = useResolvedTheme();
  return theme === 'dark' ? DARK : LIGHT;
}
