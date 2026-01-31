import { promises as fs } from 'fs';
import path from 'path';
import {CacheOptions, Opts, getCacheMap, getMountArgsString, getTargetPath, getBuilder} from './opts.js';
import { run } from './run.js';

async function extractCache(cacheSource: string, cacheOptions: CacheOptions, scratchDir: string, containerImage: string, builder: string) {
    // Prepare Timestamp for Layer Cache Busting
    const date = new Date().toISOString();

    await fs.mkdir(scratchDir, { recursive: true });
    await fs.writeFile(path.join(scratchDir, 'buildstamp'), date);

    // Prepare Dancefile to Access Caches
    const targetPath = getTargetPath(cacheOptions);
    const mountArgs = getMountArgsString(cacheOptions);

    const dancefileContent = `
FROM ${containerImage} AS dance-extract
COPY buildstamp buildstamp
RUN --mount=${mountArgs} \
    mkdir -p /var/dance-cache/ \
    && tar -czf /var/dance-cache/dance-cache.tar.gz -C ${targetPath} .

FROM scratch
COPY --from=dance-extract /var/dance-cache/dance-cache.tar.gz /dance-cache.tar.gz
`;
    await fs.writeFile(path.join(scratchDir, 'Dancefile.extract'), dancefileContent);
    console.log(dancefileContent);

    // Extract Data
    await run('docker', ['buildx', 'build', '--builder', builder, '-f', path.join(scratchDir, 'Dancefile.extract'), '--output', `type=local,dest=${scratchDir}` , scratchDir]);

    // Unpack Cache Archive
    await fs.mkdir(path.join(scratchDir, 'dance-cache'), { recursive: true });
    await run('tar', ['-x', '-C', path.join(scratchDir, 'dance-cache'), '-f', path.join(scratchDir, 'dance-cache.tar.gz')]);

    // Move Cache into Its Place
    await run('sudo', ['rm', '-rf', cacheSource]);
    await fs.rename(path.join(scratchDir, 'dance-cache'), cacheSource);
}

export async function extractCaches(opts: Opts) {
    if (opts["skip-extraction"]) {
        console.log("skip-extraction is set. Skipping extraction step...");
        return;
    }

    const cacheMap = await getCacheMap(opts);
    const scratchDir = opts['scratch-dir'];
    const containerImage = opts['utility-image'];
    const builder = getBuilder(opts);

    // Extract Caches for each source-target pair
    for (const [cacheSource, cacheOptions] of Object.entries(cacheMap)) {
        await extractCache(cacheSource, cacheOptions, scratchDir, containerImage, builder);
    }
}
