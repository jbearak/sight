import type { StataLSPConfig } from '../types';
import type { DeepPartial } from '../config-file';

export {
    type DeepPartial,
    map_public_config_to_partial_config as map_stata_lsp_json_to_partial_config,
} from '../config-file';

export function read_workspace_file_config_from_root(
    _workspace_root: string
): { partial_config: DeepPartial<StataLSPConfig>; error?: string } {
    return { partial_config: {} };
}
