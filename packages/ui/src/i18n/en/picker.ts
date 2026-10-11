import type zh from '../zh/picker';

const en: typeof zh = {
  none: 'Choose a model',
  search: 'Search',
  searchHint: 'Search models, or type a model id',
  voiceSearch: 'Search voices',
  voiceHint: 'Press the button on the left to listen without choosing',
  recommended: 'Recommended',
  noVision: 'no images',
  useTyped: 'Use the typed model id',
  useOn: (v) => `Use “${v.id}” on ${v.provider}`,
  noMatch: 'Nothing matches',
  noProvider: 'No provider connected yet',
  manage: 'Providers and models',
};
export default en;
