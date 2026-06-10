export const THEMES = {
  'dark-editorial-magazine': {
    id: 'dark-editorial-magazine',
    name: '暗金杂志封面风格',
    preview: 'assets/theme-previews/theme-01-dark-editorial-magazine.png',
    background: [
      'radial-gradient(ellipse at 50% 3%, rgba(243,218,151,.22), transparent 30%)',
      'radial-gradient(circle at 88% 18%, rgba(217,63,52,.12), transparent 24%)',
      'linear-gradient(180deg, #111820 0%, #15110e 56%, #07090d 100%)'
    ].join(', '),
    tokens: {
      pageBg: '#0d1218',
      panelBg: '#f2e5cc',
      panelSubtle: 'rgba(242,229,204,.12)',
      panelBorder: 'rgba(215,181,109,.68)',
      textMain: '#f8edcf',
      textPanel: '#211b16',
      textMuted: '#817563',
      accentBullish: '#d93f34',
      accentBearish: '#0a9d70',
      accentStructure: '#2c75b8',
      accentGold: '#d7b56d',
      shadowPanel: '0 18px 42px rgba(0,0,0,.32)',
      radiusPanel: '6px',
      radiusChip: '4px'
    }
  },
  'light-institutional-report': {
    id: 'light-institutional-report',
    name: '浅色机构午报风格',
    preview: 'assets/theme-previews/theme-02-light-institutional-report.png',
    background: [
      'radial-gradient(circle at 18% 8%, rgba(183,141,62,.16), transparent 24%)',
      'radial-gradient(circle at 94% 10%, rgba(37,79,115,.10), transparent 32%)',
      'linear-gradient(154deg, #f8f3e8 0%, #eef2f3 58%, #fbf8f0 100%)'
    ].join(', '),
    tokens: {
      pageBg: '#f8f3e8',
      panelBg: 'rgba(255,255,255,.96)',
      panelSubtle: 'rgba(37,79,115,.06)',
      panelBorder: 'rgba(37,79,115,.22)',
      textMain: '#153450',
      textPanel: '#162331',
      textMuted: '#647282',
      accentBullish: '#d93f34',
      accentBearish: '#0a9d70',
      accentStructure: '#1f6eb3',
      accentGold: '#b08d3e',
      shadowPanel: '0 12px 30px rgba(33,47,61,.12)',
      radiusPanel: '6px',
      radiusChip: '4px'
    }
  },
  'dark-terminal-magazine': {
    id: 'dark-terminal-magazine',
    name: '深色终端杂志风格',
    preview: 'assets/theme-previews/theme-03-dark-terminal-magazine.png',
    background: [
      'radial-gradient(circle at 13% 9%, rgba(49,166,214,.16), transparent 24%)',
      'radial-gradient(circle at 92% 18%, rgba(215,181,109,.14), transparent 25%)',
      'linear-gradient(155deg, #090f16 0%, #101923 48%, #070a0e 100%)'
    ].join(', '),
    tokens: {
      pageBg: '#090f16',
      panelBg: '#111d27',
      panelSubtle: 'rgba(49,166,214,.08)',
      panelBorder: 'rgba(88,118,142,.42)',
      textMain: '#e8f1f6',
      textPanel: '#e8f1f6',
      textMuted: '#8da2af',
      accentBullish: '#ff4b55',
      accentBearish: '#11c5b7',
      accentStructure: '#31a6d6',
      accentGold: '#d7b56d',
      shadowPanel: '0 14px 34px rgba(0,0,0,.34)',
      radiusPanel: '6px',
      radiusChip: '4px'
    }
  }
};

const THEME_NAME_TO_ID = new Map(
  Object.values(THEMES).map((theme) => [theme.name, theme.id])
);

export function resolveTheme(themeNameOrId = '暗金杂志封面风格') {
  const id = THEMES[themeNameOrId] ? themeNameOrId : THEME_NAME_TO_ID.get(themeNameOrId);
  if (!id || !THEMES[id]) throw new Error(`Unknown theme: ${themeNameOrId}`);
  return THEMES[id];
}

export function themeOptions() {
  return Object.values(THEMES).map((theme) => ({
    id: theme.id,
    name: theme.name,
    preview: theme.preview
  }));
}
