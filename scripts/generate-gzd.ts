import { writeFileSync } from 'fs';
import { generateGZDGeoJSON } from '../src/utils/generateGZD';

const gzdData = generateGZDGeoJSON();
writeFileSync('public/gzds.json', JSON.stringify(gzdData, null, 2));

console.log(`Generated ${gzdData.features.length} GZD zones`);
