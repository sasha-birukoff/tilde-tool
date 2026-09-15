// ============================================================================
// Tilde Graph Architect - Pure JavaScript Graph Visualization
// ============================================================================

// Configuration defaults
const config = {
    svgWidth: 1400,
    svgHeight: 1400,
    marginLeft: 100,
    marginRight: 100,
    marginTop: 100,
    marginBottom: 100,
    columnSpacing: 1.0,
    rowSpacing: 0.5,
    lineThickness: 0.5,
    lineColor: '#575757',
    nodeBaseSize: 5.5,
    nodeScaleK: 1.0,
    nodeColor: '#F3F3F4',
    mergeTolerance: 1,
    showEdgeNodes: true,
    bgColor: '#010204',
    animationEnabled: true,
    animationDuration: 9,
    waveWidth: 0.9,
    fadeSpeed: 5,
    wavePattern: 'sequence',
    inactiveNodeColor: '#454545',
    activeNodeColor: '#AFF3F8',
};

let lastSvg = '';
let lastStats = { nodes: 0, edges: 0, intersections: 0 };
let activePresetIndex = 0;
let animationFrameId = null;
let animationStartTime = null;
let animationPausedAt = 0;
let animationPlaying = true;

// Preset configurations
const presets = [
    { name: 'Diamond', nodes: '1,5,3,5,1', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Bow', nodes: '8,3,8', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Pinch', nodes: '3,1,3', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Burst', nodes: '1,8,1', columnSpacing: 1.0, rowSpacing: 1.0 },
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse nodes per column input string (e.g., "1,5,6")
 */
function parseNodesPerColumn(inputStr) {
    if (!inputStr || inputStr.trim() === '') {
        return [1, 5, 3, 5, 1];
    }

    const parts = inputStr.split(',').map(s => s.trim()).filter(s => s !== '');
    const nums = parts.map(s => {
        const n = parseInt(s, 10);
        return isNaN(n) ? 0 : Math.max(1, Math.min(8, n));
    }).filter(n => n > 0);

    if (nums.length === 0) {
        return [1, 5, 3, 5, 1];
    }

    const clamped = nums.slice(0, 7);
    if (clamped.length < 2) {
        while (clamped.length < 2) {
            clamped.push(1);
        }
    }

    return clamped;
}

/**
 * Read all control inputs and update config object
 */
function readControlsToConfig() {
    const nodesInput = document.getElementById('nodesInput').value;

    config.columnSpacing = Math.max(0.05, parseFloat(document.getElementById('columnSpacing').value) || 0.05);
    config.rowSpacing = Math.max(0.05, parseFloat(document.getElementById('rowSpacing').value) || 0.05);
    config.nodeBaseSize = parseFloat(document.getElementById('nodeBaseSize').value) || 2;

    config.nodesPerColumn = parseNodesPerColumn(nodesInput);
}

/**
 * Generate nodes for each column
 */
function generateNodes(cfg) {
    const nodes = [];
    const columns = [];
    let nodeId = 0;

    const innerWidth = cfg.svgWidth - cfg.marginLeft - cfg.marginRight;
    const innerHeight = cfg.svgHeight - cfg.marginTop - cfg.marginBottom;

    cfg.nodesPerColumn.forEach((nodeCount, colIndex) => {
        const colNodes = [];

        const spacingFraction = cfg.nodesPerColumn.length > 1
            ? (colIndex / (cfg.nodesPerColumn.length - 1)) * cfg.columnSpacing
            : 0;
        const colX = cfg.marginLeft + spacingFraction * innerWidth;

        for (let rowIndex = 0; rowIndex < nodeCount; rowIndex++) {
            let nodeY;
            if (nodeCount === 1) {
                nodeY = cfg.svgHeight / 2;
            } else {
                const fraction = rowIndex / (nodeCount - 1);
                const spacingFraction = fraction * cfg.rowSpacing;
                nodeY = cfg.marginTop + spacingFraction * innerHeight;
            }

            const node = {
                id: nodeId,
                colIndex,
                rowIndex,
                x: colX,
                y: nodeY,
                degree: 0,
            };

            nodes.push(node);
            colNodes.push(nodeId);
            nodeId++;
        }

        columns.push(colNodes);
    });

    return { nodes, columns };
}

/**
 * Generate edges between adjacent columns
 */
function generateEdges(nodes, columns) {
    const edges = [];

    for (let colIdx = 0; colIdx < columns.length - 1; colIdx++) {
        const col1 = columns[colIdx];
        const col2 = columns[colIdx + 1];

        for (const nodeId1 of col1) {
            for (const nodeId2 of col2) {
                edges.push({ a: nodeId1, b: nodeId2 });
                nodes[nodeId1].degree++;
                nodes[nodeId2].degree++;
            }
        }
    }

    return edges;
}

/**
 * Line segment intersection test
 */
function lineSegmentIntersection(p1, p2, p3, p4) {
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y;
    const x4 = p4.x, y4 = p4.y;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) {
        return null;
    }

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

    if (t > 0 && t < 1 && u > 0 && u < 1) {
        const ix = x1 + t * (x2 - x1);
        const iy = y1 + t * (y2 - y1);
        return { x: ix, y: iy };
    }

    return null;
}

/**
 * Compute all line–line intersections and merge nearby ones
 */
function computeIntersections(nodes, edges, cfg) {
    const intersections = [];

    for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
            const e1 = edges[i];
            const e2 = edges[j];

            if (e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b) {
                continue;
            }

            const p1 = nodes[e1.a];
            const p2 = nodes[e1.b];
            const p3 = nodes[e2.a];
            const p4 = nodes[e2.b];

            const intersection = lineSegmentIntersection(p1, p2, p3, p4);
            if (!intersection) {
                continue;
            }

            let merged = false;
            for (const existing of intersections) {
                const dist = Math.sqrt(
                    (existing.x - intersection.x) ** 2 +
                    (existing.y - intersection.y) ** 2
                );
                if (dist < cfg.mergeTolerance) {
                    existing.count++;
                    merged = true;
                    break;
                }
            }

            if (!merged) {
                intersections.push({
                    x: intersection.x,
                    y: intersection.y,
                    count: 1,
                });
            }
        }
    }

    return intersections;
}

/**
 * Build SVG markup string with auto-sizing
 */
function buildSvg(nodes, edges, intersections, cfg) {
    let svgContent = '';

    for (const edge of edges) {
        const node1 = nodes[edge.a];
        const node2 = nodes[edge.b];
        svgContent += `<line class="graph-line" x1="${node1.x}" y1="${node1.y}" x2="${node2.x}" y2="${node2.y}" ` +
            `stroke="${cfg.lineColor}" stroke-width="${cfg.lineThickness}" fill="none" />`;
    }

    for (const inter of intersections) {
        const size = cfg.nodeBaseSize + cfg.nodeScaleK * inter.count;
        if (size > 0) {
            const half = size / 2;
            svgContent += `<rect class="graph-node" data-node-x="${inter.x}" data-node-y="${inter.y}" x="${inter.x - half}" y="${inter.y - half}" ` +
                `width="${size}" height="${size}" fill="${cfg.nodeColor}" />`;
        }
    }

    for (const node of nodes) {
        if (!cfg.showEdgeNodes) {
            const isLeftmost = node.colIndex === 0;
            const isRightmost = node.colIndex === cfg.nodesPerColumn.length - 1;
            if (isLeftmost || isRightmost) {
                continue;
            }
        }

        const size = cfg.nodeBaseSize + cfg.nodeScaleK * node.degree;
        if (size > 0) {
            const half = size / 2;
            svgContent += `<rect class="graph-node" data-node-x="${node.x}" data-node-y="${node.y}" x="${node.x - half}" y="${node.y - half}" ` +
                `width="${size}" height="${size}" fill="${cfg.nodeColor}" />`;
        }
    }

    let minX = cfg.svgWidth, maxX = 0, minY = cfg.svgHeight, maxY = 0;

    for (const node of nodes) {
        const size = cfg.nodeBaseSize + cfg.nodeScaleK * node.degree;
        const half = size / 2;
        minX = Math.min(minX, node.x - half);
        maxX = Math.max(maxX, node.x + half);
        minY = Math.min(minY, node.y - half);
        maxY = Math.max(maxY, node.y + half);
    }

    for (const inter of intersections) {
        const interBaseSize = cfg.nodeBaseSize + cfg.nodeScaleK;
        const size = interBaseSize + cfg.nodeScaleK * inter.count;
        const half = size / 2;
        minX = Math.min(minX, inter.x - half);
        maxX = Math.max(maxX, inter.x + half);
        minY = Math.min(minY, inter.y - half);
        maxY = Math.max(maxY, inter.y + half);
    }

    const padding = cfg.lineThickness / 2;
    minX -= padding;
    maxX += padding;
    minY -= padding;
    maxY += padding;

    const width = maxX - minX;
    const height = maxY - minY;

    const svg = `<svg width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
${svgContent}
</svg>`;

    return svg;
}

/**
 * Generate a mini SVG preview for presets
 */
function generatePresetPreview(nodesStr) {
    const nodesPerColumn = parseNodesPerColumn(nodesStr);
    const previewSize = 48;
    const margin = 8;
    const innerSize = previewSize - margin * 2;

    let svgContent = '';
    const columns = [];

    // Generate node positions
    nodesPerColumn.forEach((count, colIdx) => {
        const x = margin + (colIdx / Math.max(1, nodesPerColumn.length - 1)) * innerSize;
        const colNodes = [];

        for (let i = 0; i < count; i++) {
            const y = count === 1
                ? previewSize / 2
                : margin + (i / (count - 1)) * innerSize;
            colNodes.push({ x, y });
        }
        columns.push(colNodes);
    });

    // Draw edges with gradient colors
    for (let i = 0; i < columns.length - 1; i++) {
        for (const n1 of columns[i]) {
            for (const n2 of columns[i + 1]) {
                svgContent += `<line x1="${n1.x}" y1="${n1.y}" x2="${n2.x}" y2="${n2.y}" stroke="rgba(69, 116, 140, 0.6)" stroke-width="0.75"/>`;
            }
        }
    }

    // Draw nodes with light gradient color
    for (const col of columns) {
        for (const n of col) {
            svgContent += `<circle cx="${n.x}" cy="${n.y}" r="2" fill="#BFE8FE"/>`;
        }
    }

    return `<svg viewBox="0 0 ${previewSize} ${previewSize}" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`;
}

/**
 * Update stats display
 */
function updateStats(nodeCount, edgeCount, intersectionCount) {
    const statNodes = document.getElementById('statNodes');
    const statEdges = document.getElementById('statEdges');
    const statIntersections = document.getElementById('statIntersections');

    if (statNodes) statNodes.textContent = nodeCount;
    if (statEdges) statEdges.textContent = edgeCount;
    if (statIntersections) statIntersections.textContent = intersectionCount;
    lastStats = { nodes: nodeCount, edges: edgeCount, intersections: intersectionCount };
}

/**
 * Update slider progress indicator
 */
function updateSliderProgress(slider) {
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const val = parseFloat(slider.value);
    const progress = ((val - min) / (max - min)) * 100;
    slider.style.setProperty('--progress', `${progress}%`);
}

/**
 * Main render function
 */
function render() {
    readControlsToConfig();

    const { nodes, columns } = generateNodes(config);
    const edges = generateEdges(nodes, columns);
    const intersections = computeIntersections(nodes, edges, config);

    lastSvg = buildSvg(nodes, edges, intersections, config);

    const preview = document.getElementById('preview');
    preview.innerHTML = lastSvg;
    applyAnimationFrame(animationPlaying ? getAnimationProgress() : animationPausedAt);

    // Update stats
    updateStats(nodes.length, edges.length, intersections.length);
}

// Generation 7 live node-wave animation.
const clamp01 = value => Math.max(0, Math.min(1, value));

function smoothstep(min, max, value) {
    const unit = clamp01((value - min) / (max - min));
    return unit * unit * (3 - 2 * unit);
}

function gaussian(distance, width) {
    return Math.exp(-(distance * distance) / (2 * width * width));
}

function windowedWave(coordinate, progress, start, end, from, to, width) {
    const local = smoothstep(start, end, progress);
    const center = from + (to - from) * local;
    const fadeInCenter = start + 0.025;
    const fadeOutCenter = end - 0.01;
    const fadeInHalfWidth = 0.075 / config.fadeSpeed;
    const fadeOutHalfWidth = 0.09 / config.fadeSpeed;
    const fadeIn = smoothstep(fadeInCenter - fadeInHalfWidth, fadeInCenter + fadeInHalfWidth, progress);
    const fadeOut = 1 - smoothstep(fadeOutCenter - fadeOutHalfWidth, fadeOutCenter + fadeOutHalfWidth, progress);
    return gaussian(coordinate - center, width * config.waveWidth) * fadeIn * fadeOut;
}

function waveEnergy(nx, ny, progress) {
    const radial = windowedWave(Math.hypot(nx, ny), progress, 0.08, 0.27, -0.08, 1.30, 0.16);
    const forward = windowedWave(nx * 0.72 - ny * 0.70, progress, 0.36, 0.59, -1.18, 1.18, 0.18);
    const backward = windowedWave(nx * 0.72 + ny * 0.70, progress, 0.69, 0.94, 1.22, -1.22, 0.17);
    const echo = windowedWave(nx * 0.45 - ny * 0.30, progress, 0.70, 0.98, -0.95, 0.95, 0.28) * 0.22;

    if (config.wavePattern === 'radial') return radial;
    if (config.wavePattern === 'diagonal-forward') return windowedWave(nx * 0.72 - ny * 0.70, progress, 0.08, 0.92, -1.18, 1.18, 0.18);
    if (config.wavePattern === 'diagonal-back') return windowedWave(nx * 0.72 + ny * 0.70, progress, 0.08, 0.92, 1.18, -1.18, 0.17);
    return clamp01(Math.max(radial, forward, backward, echo));
}

function hexToRgb(hex) {
    const normalized = hex.replace('#', '');
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16),
    };
}

function mixColors(fromHex, toHex, amount) {
    const from = hexToRgb(fromHex);
    const to = hexToRgb(toHex);
    const channel = key => Math.round(from[key] + (to[key] - from[key]) * amount);
    return `rgb(${channel('r')}, ${channel('g')}, ${channel('b')})`;
}

function applyAnimationFrame(progress) {
    const preview = document.getElementById('preview');
    if (!preview) return;

    preview.querySelectorAll('.graph-line').forEach(line => line.setAttribute('stroke', config.lineColor));
    preview.querySelectorAll('.graph-node').forEach(node => {
        if (!config.animationEnabled) {
            node.setAttribute('fill', config.nodeColor);
            return;
        }
        const x = Number(node.dataset.nodeX);
        const y = Number(node.dataset.nodeY);
        const halfSpan = Math.max((config.svgWidth - config.marginLeft - config.marginRight) / 2, (config.svgHeight - config.marginTop - config.marginBottom) / 2);
        const nx = (x - config.svgWidth / 2) / halfSpan;
        const ny = (y - config.svgHeight / 2) / halfSpan;
        node.setAttribute('fill', mixColors(config.inactiveNodeColor, config.activeNodeColor, waveEnergy(nx, ny, progress)));
    });
}

function getAnimationProgress(timestamp = performance.now()) {
    if (animationStartTime === null) animationStartTime = timestamp;
    return ((timestamp - animationStartTime) / (config.animationDuration * 1000)) % 1;
}

function animationLoop(timestamp) {
    if (animationPlaying && config.animationEnabled) {
        animationPausedAt = getAnimationProgress(timestamp);
        applyAnimationFrame(animationPausedAt);
    }
    animationFrameId = requestAnimationFrame(animationLoop);
}

function restartAnimation() {
    animationStartTime = performance.now();
    animationPausedAt = 0;
    applyAnimationFrame(0);
}

function updatePlayPauseButton() {
    document.getElementById('playPauseBtn').textContent = animationPlaying ? 'Pause' : 'Play';
}

/**
 * Apply a preset
 */
function applyPreset(index) {
    const preset = presets[index];
    if (!preset) return;

    activePresetIndex = index;

    // Update nodes input only - keep other settings as-is
    document.getElementById('nodesInput').value = preset.nodes.replaceAll(',', ', ');

    // Update preset buttons
    document.querySelectorAll('.preset-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });

    render();
}

/**
 * Generate random nodes configuration
 */
function randomizeNodes() {
    const numColumns = Math.floor(Math.random() * 4) + 3; // 3-6 columns
    const nodes = [];
    for (let i = 0; i < numColumns; i++) {
        nodes.push(Math.floor(Math.random() * 5) + 1); // 1-5 nodes
    }
    document.getElementById('nodesInput').value = nodes.join(', ');

    // Clear active preset
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

    render();
}

function resetGenerator() {
    document.getElementById('columnSpacing').value = '1';
    document.getElementById('rowSpacing').value = '0.5';
    document.getElementById('nodeBaseSize').value = '5.5';
    document.getElementById('columnSpacingValue').textContent = '100%';
    document.getElementById('rowSpacingValue').textContent = '50%';
    document.getElementById('nodeBaseSizeValue').textContent = '5.5';
    document.querySelectorAll('.slider').forEach(updateSliderProgress);
    applyPreset(0);
}

/**
 * Reset all controls to default values
 */
/**
 * Download SVG as file
 */
function downloadSvg() {
    if (!lastSvg) {
        return;
    }

    const blob = new Blob([lastSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tilde-graph.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Copy SVG markup to the clipboard
 */
async function copySvg() {
    if (!lastSvg) {
        return;
    }

    const button = document.getElementById('copyBtn');
    const originalLabel = button.textContent;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(lastSvg);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = lastSvg;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }

        button.textContent = 'Copied';
    } catch (error) {
        button.textContent = 'Try again';
    }

    window.setTimeout(() => {
        button.textContent = originalLabel;
    }, 1400);
}

// ============================================================================
// Initialize on Page Load
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Generate preset buttons
    const presetsGrid = document.getElementById('presetsGrid');
    presets.forEach((preset, index) => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn' + (index === 0 ? ' active' : '');
        btn.innerHTML = generatePresetPreview(preset.nodes);
        btn.title = preset.name;
        btn.addEventListener('click', () => applyPreset(index));
        presetsGrid.appendChild(btn);
    });

    // Set up nodes input with auto-comma formatting
    const nodesInput = document.getElementById('nodesInput');
    nodesInput.addEventListener('input', (e) => {
        // Get cursor position before formatting
        const cursorPos = e.target.selectionStart;
        const oldValue = e.target.value;

        // Remove all non-digits, then restore the designed comma spacing.
        const digits = oldValue.replace(/[^0-9]/g, '').split('');
        const formatted = digits.join(', ');

        // Update value
        e.target.value = formatted;

        // Adjust cursor position (account for added commas)
        const digitsTyped = (oldValue.slice(0, cursorPos).match(/\d/g) || []).length;
        const newCursorPos = digitsTyped > 0 ? digitsTyped * 3 - 2 : 0;
        e.target.setSelectionRange(Math.min(newCursorPos, formatted.length), Math.min(newCursorPos, formatted.length));

        // Clear active preset when manually editing
        document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
        render();
    });

    // Set up randomize button
    document.getElementById('randomizeBtn').addEventListener('click', randomizeNodes);
    document.getElementById('resetBtn').addEventListener('click', resetGenerator);

    // Button event listeners
    document.getElementById('copyBtn').addEventListener('click', copySvg);
    document.getElementById('downloadBtn').addEventListener('click', downloadSvg);

    document.getElementById('animationEnabled').addEventListener('change', event => {
        config.animationEnabled = event.target.checked;
        if (config.animationEnabled) restartAnimation();
        else applyAnimationFrame(0);
    });

    document.getElementById('playPauseBtn').addEventListener('click', () => {
        animationPlaying = !animationPlaying;
        if (animationPlaying) animationStartTime = performance.now() - animationPausedAt * config.animationDuration * 1000;
        updatePlayPauseButton();
    });

    document.getElementById('restartAnimationBtn').addEventListener('click', restartAnimation);

    document.getElementById('animationDuration').addEventListener('input', event => {
        config.animationDuration = Number(event.target.value);
        document.getElementById('animationDurationValue').textContent = `${Number(config.animationDuration.toFixed(1))}s`;
        updateSliderProgress(event.target);
        restartAnimation();
    });

    document.getElementById('waveWidth').addEventListener('input', event => {
        config.waveWidth = Number(event.target.value);
        document.getElementById('waveWidthValue').textContent = config.waveWidth.toFixed(2);
        updateSliderProgress(event.target);
        applyAnimationFrame(animationPausedAt);
    });

    document.getElementById('fadeSpeed').addEventListener('input', event => {
        config.fadeSpeed = Number(event.target.value);
        document.getElementById('fadeSpeedValue').textContent = `${Number(config.fadeSpeed.toFixed(1))}×`;
        updateSliderProgress(event.target);
        applyAnimationFrame(animationPausedAt);
    });

    document.getElementById('wavePattern').addEventListener('change', event => {
        config.wavePattern = event.target.value;
        restartAnimation();
    });

    document.getElementById('lineColor').addEventListener('input', event => {
        config.lineColor = event.target.value.toUpperCase();
        render();
    });

    document.getElementById('inactiveNodeColor').addEventListener('input', event => {
        config.inactiveNodeColor = event.target.value;
        applyAnimationFrame(animationPausedAt);
    });

    document.getElementById('activeNodeColor').addEventListener('input', event => {
        config.activeNodeColor = event.target.value;
        applyAnimationFrame(animationPausedAt);
    });

    // Map of slider IDs to their value display IDs
    const sliderValueMap = {
        'columnSpacing': 'columnSpacingValue',
        'rowSpacing': 'rowSpacingValue',
        'nodeBaseSize': 'nodeBaseSizeValue'
    };

    // Set up sliders
    Object.entries(sliderValueMap).forEach(([sliderId, valueId]) => {
        const slider = document.getElementById(sliderId);
        const valueDisplay = document.getElementById(valueId);

        if (slider && valueDisplay) {
            // Initial progress
            updateSliderProgress(slider);

            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                valueDisplay.textContent = sliderId === 'nodeBaseSize'
                    ? Number(value.toFixed(1)).toString()
                    : `${Math.round(value * 100)}%`;
                updateSliderProgress(slider);
                render();
            });
        }
    });

    // Initialize with defaults.
    document.querySelectorAll('.slider, .motion-slider').forEach(updateSliderProgress);
    applyPreset(0);
    updatePlayPauseButton();
    if (animationFrameId === null) animationFrameId = requestAnimationFrame(animationLoop);
});
