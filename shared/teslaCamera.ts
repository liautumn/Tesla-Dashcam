import type {CamName} from './types/index.js'

export const teslaVideoNamePattern =
    /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$/

const cameraBySuffix: Record<string, CamName> = {
    front: 'front',
    back: 'back',
    left_repeater: 'left',
    right_repeater: 'right',
    left_pillar: 'left_pillar',
    right_pillar: 'right_pillar',
}

export const parseTeslaVideoName = (fileName: string) => {
    const match = teslaVideoNamePattern.exec(fileName)
    if (!match) return undefined

    return {
        segmentName: match[1],
        camera: cameraBySuffix[match[2]],
    }
}

export const isTeslaCameraVideoName = (fileName: string) =>
    teslaVideoNamePattern.test(fileName)
