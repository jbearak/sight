import * as path from 'path';
import type { VviewSidecar } from './types';
import { BROWSE_DIR } from './signal-watcher';

export const DATA_BROWSER_PANEL_VIEW_TYPE =
    'sightDataBrowser';
export const DATA_BROWSER_EDITOR_VIEW_TYPE =
    'sight.dataBrowserEditor';

export function build_direct_open_sidecar(
    dta_path: string
): VviewSidecar {
    return {
        version: 1,
        uuid: `direct:${dta_path}`,
        name: path.parse(dta_path).name,
        dtapath: dta_path,
        N: 0,
        k: 0,
        replace: false,
        subsetted: false,
        source: dta_path,
    };
}

export function should_unlink_data_browser_path(
    candidate_path: string,
    browse_dir: string = BROWSE_DIR
): boolean {
    const my_browse_dir = path.resolve(browse_dir);
    const my_candidate = path.resolve(candidate_path);
    const my_relative = path.relative(
        my_browse_dir,
        my_candidate
    );

    return (
        my_relative !== ''
        && !my_relative.startsWith('..')
        && !path.isAbsolute(my_relative)
    );
}
