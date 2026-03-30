import * as path from 'path';

export function resolve_personal_ado_dir(
    custom_dir: string,
    home_dir: string,
    platform: NodeJS.Platform
): string {
    if (custom_dir) {
        return custom_dir.replace(
            /^~(?=\/|$)/,
            home_dir
        );
    }

    switch (platform) {
        case 'darwin':
            return path.join(
                home_dir,
                'ado'
            );
        case 'win32':
            return path.join(
                home_dir,
                'ado',
                'personal'
            );
        default:
            return path.join(
                home_dir,
                'ado',
                'personal'
            );
    }
}
