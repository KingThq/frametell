import type zh from '../zh/settings';

const en: typeof zh = {
  title: 'Settings',
  close: 'Close settings',
  loading: 'Loading settings…',
  back: 'Back',
  nav: { models: 'Model providers', voice: 'Voices', general: 'General', network: 'Network proxy', machine: 'This computer' },
  language: {
    title: 'Language',
    desc: 'The language of the interface.',
    auto: 'Follow system',
    zh: '中文',
    en: 'English',
  },
  voice: {
    desc: 'You can make a film without one; it just has no voice. Keys stay on this computer.',
    volcengine: 'Volcengine',
    elevenlabs: 'ElevenLabs',
    volcengineBlurb: 'Doubao speech synthesis, Chinese voices',
    elevenlabsBlurb: 'Voices in many languages, including your own voice library',
  },
  net: {
    title: 'Network proxy',
    desc: "Fill this in if you can't reach the official services. Model, voice and agent requests all go through it; local addresses don't.",
    proxy: 'HTTP proxy',
  },
  env: {
    title: 'This computer',
    ok: 'OK',
    fix: 'Needs attention',
    chrome: 'Browser (for rendering)',
    ffmpeg: 'Video encoding',
    git: 'Version history (undo)',
    node: 'Node.js',
    where: 'Settings are saved in ~/.frametell/config.json, readable only by you.',
  },
};

export default en;
