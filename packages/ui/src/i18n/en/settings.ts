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
    desc: "Narration needs it: until it's connected you can listen to the voices but not make a film with them. Keys stay on this computer.",
    volcengine: 'Volcengine',
    elevenlabs: 'ElevenLabs',
    volcengineBlurb: 'Doubao speech synthesis, Chinese voices',
    elevenlabsBlurb: 'Voices in many languages, including your own voice library',
    mineDesc: 'Any voice from the Volcengine library, or one you cloned (S_…), by its ID. They lead every voice list.',
    rename: 'Rename {id}',
    remove: 'Remove {name}',
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
