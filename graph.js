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
    columnSpacing: 1.5,
    rowSpacing: 0.8,
    lineThickness: 0.5,
    lineColor: '#AFAFAF',
    nodeBaseSize: 9,
    nodeScaleK: 0.5,
    nodeColor: '#F3F3F4',
    mergeTolerance: 1,
    showEdgeNodes: true,
    bgColor: '#060709',
    animationEnabled: true,
    animationDuration: 6,
    waveWidth: 0.4,
    fadeSpeed: 5,
    wavePattern: 'sequence',
    nodeColorMode: 'vibrant',
    inactiveNodeColor: '#646464',
    connectionLowColor: '#30394A',
    connectionHighColor: '#AFF3F8',
    activeNodeColor: '#FFFFFF',
};

let lastSvg = '';
let lastStats = { nodes: 0, edges: 0, intersections: 0 };
let activePresetIndex = 1;
let animationFrameId = null;
let animationStartTime = null;
let animationPausedAt = 0;
let animationPlaying = true;
let exportInProgress = false;
let cancelRequested = false;
let ffmpegInstance = null;

// Preset configurations
const presets = [
    { name: 'Diamond', nodes: '1,5,3,5,1', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Bow', nodes: '8,3,8', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Pinch', nodes: '3,1,3', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Burst', nodes: '1,8,1', columnSpacing: 1.0, rowSpacing: 1.0 },
];

const vibrantDegreePalette = [
    { max: 4, color: '#FF1111' },
    { max: 6, color: '#FF7417' },
    { max: 8, color: '#FFD31A' },
    { max: 9, color: '#58F20B' },
    { max: 10, color: '#149797' },
    { max: 12, color: '#3120DF' },
    { max: 14, color: '#9A3FD1' },
    { max: Infinity, color: '#E65FBD' },
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
                    existing.edgeIds.add(i);
                    existing.edgeIds.add(j);
                    merged = true;
                    break;
                }
            }

            if (!merged) {
                intersections.push({
                    x: intersection.x,
                    y: intersection.y,
                    count: 1,
                    edgeIds: new Set([i, j]),
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
            svgContent += `<rect class="graph-node" data-node-x="${inter.x}" data-node-y="${inter.y}" data-node-degree="${inter.edgeIds.size * 2}" x="${inter.x - half}" y="${inter.y - half}" ` +
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
            svgContent += `<rect class="graph-node" data-node-x="${node.x}" data-node-y="${node.y}" data-node-degree="${node.degree}" x="${node.x - half}" y="${node.y - half}" ` +
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

function colorToRgb(color) {
    const rgbMatch = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
        return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
    }
    const normalized = color.replace('#', '');
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16),
    };
}

function mixColors(fromHex, toHex, amount) {
    const from = colorToRgb(fromHex);
    const to = colorToRgb(toHex);
    const channel = key => Math.round(from[key] + (to[key] - from[key]) * amount);
    return `rgb(${channel('r')}, ${channel('g')}, ${channel('b')})`;
}

function getNodeBaseColor(node, minDegree, maxDegree, degreeLevels) {
    const degree = Number(node.dataset.nodeDegree);
    if (config.nodeColorMode === 'vibrant') {
        const rank = degreeLevels.indexOf(degree);
        const paletteIndex = degreeLevels.length <= 1
            ? Math.floor((vibrantDegreePalette.length - 1) / 2)
            : Math.round((rank / (degreeLevels.length - 1)) * (vibrantDegreePalette.length - 1));
        return vibrantDegreePalette[paletteIndex].color;
    }
    if (config.nodeColorMode !== 'connections') return config.inactiveNodeColor;
    const amount = maxDegree === minDegree ? 0.5 : clamp01((degree - minDegree) / (maxDegree - minDegree));
    return mixColors(config.connectionLowColor, config.connectionHighColor, amount);
}

function applyAnimationFrame(progress) {
    const preview = document.getElementById('preview');
    if (!preview) return;

    preview.querySelectorAll('.graph-line').forEach(line => line.setAttribute('stroke', config.lineColor));
    const graphNodes = [...preview.querySelectorAll('.graph-node')];
    const degrees = graphNodes.map(node => Number(node.dataset.nodeDegree));
    const minDegree = Math.min(...degrees);
    const maxDegree = Math.max(...degrees);
    const degreeLevels = [...new Set(degrees)].sort((a, b) => a - b);
    graphNodes.forEach(node => {
        const baseColor = getNodeBaseColor(node, minDegree, maxDegree, degreeLevels);
        if (!config.animationEnabled) {
            node.setAttribute('fill', baseColor);
            return;
        }
        const x = Number(node.dataset.nodeX);
        const y = Number(node.dataset.nodeY);
        const halfSpan = Math.max((config.svgWidth - config.marginLeft - config.marginRight) / 2, (config.svgHeight - config.marginTop - config.marginBottom) / 2);
        const nx = (x - config.svgWidth / 2) / halfSpan;
        const ny = (y - config.svgHeight / 2) / halfSpan;
        node.setAttribute('fill', mixColors(baseColor, config.activeNodeColor, waveEnergy(nx, ny, progress)));
    });
}

function updateColorPreview() {
    const swatches = document.querySelectorAll('.colors-entry-preview i');
    const middleColor = config.nodeColorMode === 'vibrant'
        ? vibrantDegreePalette[0].color
        : config.nodeColorMode === 'connections' ? config.connectionLowColor : config.inactiveNodeColor;
    const endColor = config.nodeColorMode === 'vibrant'
        ? vibrantDegreePalette.at(-1).color
        : config.nodeColorMode === 'connections' ? config.connectionHighColor : config.activeNodeColor;
    [config.lineColor, middleColor, endColor].forEach((color, index) => swatches[index]?.style.setProperty('--swatch', color));
    document.getElementById('connectionGradient').style.background = `linear-gradient(90deg,${config.connectionLowColor},${config.connectionHighColor})`;
}

function setNodeColorMode(mode) {
    config.nodeColorMode = mode;
    document.getElementById('uniformColorFields').hidden = mode !== 'uniform';
    document.getElementById('connectionColorFields').hidden = mode !== 'connections';
    document.getElementById('vibrantColorFields').hidden = mode !== 'vibrant';
    updateColorPreview();
    applyAnimationFrame(animationPausedAt);
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
        nodes.push(Math.floor(Math.random() * 8) + 1); // 1-8 nodes
    }
    document.getElementById('nodesInput').value = nodes.join(', ');

    // Clear active preset
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

    render();
}

function resetGenerator() {
    document.getElementById('columnSpacing').value = '1.5';
    document.getElementById('rowSpacing').value = '0.8';
    document.getElementById('nodeBaseSize').value = '9';
    document.getElementById('columnSpacingValue').textContent = '150%';
    document.getElementById('rowSpacingValue').textContent = '80%';
    document.getElementById('nodeBaseSizeValue').textContent = '9';
    document.querySelectorAll('.slider').forEach(updateSliderProgress);
    applyPreset(1);
}

/**
 * Reset all controls to default values
 */
/**
 * Download SVG as file
 */
function downloadSvg() {
    const currentSvg = document.querySelector('#preview svg')?.outerHTML;
    if (!currentSvg) {
        return;
    }

    const blob = new Blob([currentSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tilde-graph.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateExportSummary() {
    const format = document.querySelector('input[name="exportFormat"]:checked')?.value || 'mp4';
    const summary = document.getElementById('exportSummary');
    if (format === 'svg') {
        summary.innerHTML = '<span>SVG</span><span>Static vector · transparent background</span>';
    } else if (format === 'webm') {
        summary.innerHTML = `<span>WebM</span><span>1080 × 1080 · 30 fps · ${Number(config.animationDuration.toFixed(1))}s</span>`;
    } else {
        summary.innerHTML = `<span>MP4</span><span>2160 × 2160 · 30 fps · ${Number(config.animationDuration.toFixed(1))}s</span>`;
    }
}

function setPanelView(viewId) {
    if (exportInProgress && viewId !== 'exportView') return;
    ['editorView', 'colorView', 'exportView'].forEach(id => {
        document.getElementById(id).hidden = id !== viewId;
    });
}

function setExportView(isOpen) {
    setPanelView(isOpen ? 'exportView' : 'editorView');
    if (isOpen) {
        updateExportSummary();
        document.getElementById('closeExportBtn').focus();
    } else {
        document.getElementById('downloadBtn').focus();
    }
}

function setColorView(isOpen) {
    setPanelView(isOpen ? 'colorView' : 'editorView');
    if (isOpen) document.getElementById('closeColorsBtn').focus();
    else document.getElementById('openColorsBtn').focus();
}

function drawExportFrame(context, canvas, progress) {
    applyAnimationFrame(progress);
    const svg = document.querySelector('#preview svg');
    if (!svg) return;

    const viewBox = svg.viewBox.baseVal;
    const padding = canvas.width * 0.08;
    const scale = Math.min((canvas.width - padding * 2) / viewBox.width, (canvas.height - padding * 2) / viewBox.height);
    const offsetX = (canvas.width - viewBox.width * scale) / 2 - viewBox.x * scale;
    const offsetY = (canvas.height - viewBox.height * scale) / 2 - viewBox.y * scale;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = config.bgColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    svg.querySelectorAll('.graph-line').forEach(line => {
        context.beginPath();
        context.moveTo(Number(line.getAttribute('x1')), Number(line.getAttribute('y1')));
        context.lineTo(Number(line.getAttribute('x2')), Number(line.getAttribute('y2')));
        context.strokeStyle = line.getAttribute('stroke');
        context.lineWidth = Number(line.getAttribute('stroke-width'));
        context.stroke();
    });

    svg.querySelectorAll('.graph-node').forEach(node => {
        context.fillStyle = node.getAttribute('fill');
        context.fillRect(
            Number(node.getAttribute('x')),
            Number(node.getAttribute('y')),
            Number(node.getAttribute('width')),
            Number(node.getAttribute('height'))
        );
    });
}

async function captureVideo({ mimeTypes, size, bitrate }) {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
        throw new Error('Video recording is not supported in this browser.');
    }
    const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This video format is not supported in this browser.');
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
    const chunks = [];
    const durationMs = config.animationDuration * 1000;
    const wasPlaying = animationPlaying;
    animationPlaying = false;
    cancelRequested = false;

    recorder.addEventListener('dataavailable', event => {
        if (event.data.size) chunks.push(event.data);
    });

    const stopped = new Promise((resolve, reject) => {
        recorder.addEventListener('stop', resolve, { once: true });
        recorder.addEventListener('error', () => reject(recorder.error), { once: true });
    });

    drawExportFrame(context, canvas, 0);
    recorder.start(250);
    const startedAt = performance.now();
    const exportButton = document.getElementById('confirmExportBtn');

    await new Promise(resolve => {
        const capture = now => {
            const elapsed = now - startedAt;
            const progress = Math.min(elapsed / durationMs, 1);
            drawExportFrame(context, canvas, progress % 1);
            exportButton.textContent = `Exporting ${Math.round(progress * 100)}%`;
            if (progress >= 1 || cancelRequested) resolve();
            else requestAnimationFrame(capture);
        };
        requestAnimationFrame(capture);
    });

    recorder.stop();
    await stopped;
    stream.getTracks().forEach(track => track.stop());

    animationPlaying = wasPlaying;
    if (wasPlaying) restartAnimation();
    else applyAnimationFrame(animationPausedAt);
    return cancelRequested ? null : new Blob(chunks, { type: mimeType });
}

async function exportWebm() {
    const blob = await captureVideo({
        mimeTypes: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
        size: 1080,
        bitrate: 8_000_000,
    });
    if (blob) downloadBlob(blob, 'tilde-graph.webm');
}

async function getFfmpeg() {
    if (ffmpegInstance) return ffmpegInstance;
    if (!window.FFmpegWASM || !window.FFmpegUtil) throw new Error('The MP4 encoder could not be loaded.');

    const button = document.getElementById('confirmExportBtn');
    button.textContent = 'Loading encoder';
    const ffmpeg = new FFmpegWASM.FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
        if (exportInProgress) button.textContent = `Encoding ${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`;
    });
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
    await ffmpeg.load({
        coreURL: await FFmpegUtil.toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await FFmpegUtil.toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
}

async function exportMp4() {
    const nativeMp4Types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4'];
    const canRecordMp4 = window.MediaRecorder && nativeMp4Types.some(type => MediaRecorder.isTypeSupported(type));
    if (canRecordMp4) {
        const blob = await captureVideo({ mimeTypes: nativeMp4Types, size: 2160, bitrate: 24_000_000 });
        if (blob) downloadBlob(blob, 'tilde-graph-2160.mp4');
        return;
    }

    const webm = await captureVideo({
        mimeTypes: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'],
        size: 2160,
        bitrate: 24_000_000,
    });
    if (!webm || cancelRequested) return;

    const ffmpeg = await getFfmpeg();
    const inputName = 'tilde-input.webm';
    const outputName = 'tilde-output.mp4';
    await ffmpeg.writeFile(inputName, new Uint8Array(await webm.arrayBuffer()));
    await ffmpeg.exec([
        '-i', inputName,
        '-an',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outputName,
    ]);
    if (!cancelRequested) {
        const data = await ffmpeg.readFile(outputName);
        downloadBlob(new Blob([data.buffer], { type: 'video/mp4' }), 'tilde-graph-2160.mp4');
    }
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
}

async function confirmExport() {
    if (exportInProgress) return;
    const format = document.querySelector('input[name="exportFormat"]:checked')?.value || 'mp4';
    if (format === 'svg') {
        downloadSvg();
        setExportView(false);
        return;
    }

    const button = document.getElementById('confirmExportBtn');
    const cancelButton = document.getElementById('cancelExportBtn');
    let completed = false;
    exportInProgress = true;
    button.disabled = true;
    cancelButton.textContent = 'Cancel export';
    try {
        if (format === 'mp4') await exportMp4();
        else await exportWebm();
        completed = !cancelRequested;
    } catch (error) {
        button.textContent = 'Export failed';
        console.error(error);
        await new Promise(resolve => window.setTimeout(resolve, 1400));
    } finally {
        exportInProgress = false;
        cancelRequested = false;
        button.disabled = false;
        button.textContent = 'Export';
        cancelButton.textContent = 'Cancel';
        if (completed) setExportView(false);
    }
}

/**
 * Copy SVG markup to the clipboard
 */
async function copySvg() {
    const currentSvg = document.querySelector('#preview svg')?.outerHTML;
    if (!currentSvg) {
        return;
    }

    const button = document.getElementById('copyBtn');
    const originalLabel = button.textContent;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(currentSvg);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = currentSvg;
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
        btn.className = 'preset-btn' + (index === 1 ? ' active' : '');
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
    document.getElementById('openColorsBtn').addEventListener('click', () => setColorView(true));
    document.getElementById('closeColorsBtn').addEventListener('click', () => setColorView(false));
    document.getElementById('doneColorsBtn').addEventListener('click', () => setColorView(false));
    document.getElementById('downloadBtn').addEventListener('click', () => setExportView(true));
    document.getElementById('closeExportBtn').addEventListener('click', () => setExportView(false));
    document.getElementById('cancelExportBtn').addEventListener('click', () => {
        if (exportInProgress) cancelRequested = true;
        else setExportView(false);
    });
    document.getElementById('confirmExportBtn').addEventListener('click', confirmExport);
    document.querySelectorAll('input[name="exportFormat"]').forEach(input => {
        input.addEventListener('change', updateExportSummary);
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !document.getElementById('exportView').hidden) setExportView(false);
        else if (event.key === 'Escape' && !document.getElementById('colorView').hidden) setColorView(false);
    });

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
        updateColorPreview();
        render();
    });

    document.getElementById('inactiveNodeColor').addEventListener('input', event => {
        config.inactiveNodeColor = event.target.value;
        updateColorPreview();
        applyAnimationFrame(animationPausedAt);
    });

    document.getElementById('activeNodeColor').addEventListener('input', event => {
        config.activeNodeColor = event.target.value;
        updateColorPreview();
        applyAnimationFrame(animationPausedAt);
    });

    document.getElementById('connectionLowColor').addEventListener('input', event => {
        config.connectionLowColor = event.target.value;
        updateColorPreview();
        applyAnimationFrame(animationPausedAt);
    });

    document.getElementById('connectionHighColor').addEventListener('input', event => {
        config.connectionHighColor = event.target.value;
        updateColorPreview();
        applyAnimationFrame(animationPausedAt);
    });

    document.querySelectorAll('input[name="nodeColorMode"]').forEach(input => {
        input.addEventListener('change', event => setNodeColorMode(event.target.value));
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
    updateColorPreview();
    applyPreset(1);
    updatePlayPauseButton();
    if (animationFrameId === null) animationFrameId = requestAnimationFrame(animationLoop);
});
