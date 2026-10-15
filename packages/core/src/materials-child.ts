// The documents of the current folder parsed by parseMaterials, in a child a host started confined to that folder (no
// network, nothing else writable). Prints { files } as one JSON line; see prepareMaterials.
import { parseMaterials } from './materials.js';

console.log(JSON.stringify(await parseMaterials(process.cwd(), process.argv[2] === 'zh' ? 'zh' : 'en')));
