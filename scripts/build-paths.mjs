import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export const outputRoot=resolve(process.env.THINK_BUILD_DIR||resolve(projectRoot,'dist'));
export const outputPath=(...parts)=>resolve(outputRoot,...parts);
