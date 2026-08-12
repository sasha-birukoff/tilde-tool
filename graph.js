(function () {
'use strict';

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
    rowSpacing: 1.0,
    lineThickness: 0.5,
    lineColor: '#F3F3F4',
    nodeBaseSize: 8.0,
    nodeScaleK: 1.0,
    nodeColor: '#F3F3F4',
    mergeTolerance: 1,
    showEdgeNodes: true,
    bgColor: '#0B0B0C',
};

let lastSvg = '';
let lastStats = { nodes: 0, edges: 0, intersections: 0 };
let activePresetIndex = 0;
let generatorRoot = null;
let scheduledRender = null;
let renderAnimationTimer = null;
let toastTimer = null;
let baseNodesPattern = '1,5,3,5,1';

function getControl(id) {
    return generatorRoot.querySelector(`[id="${id}"]`);
}

// Preset configurations
const presets = [
    { name: 'Diamond', nodes: '1,5,3,5,1', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Cube', nodes: '5,5,5', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Wave', nodes: '1,2,3,7,3,2,1', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Pulse', nodes: '1,3,1,7,1,3,1', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Bow', nodes: '8,3,8', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Grid', nodes: '4,4,4,4', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Horizon', nodes: '1,2,3,5,3,2,1,2,1', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Burst', nodes: '1,7,1', columnSpacing: 1.0, rowSpacing: 1.0 },
];

const primaryPresetIndexes = [0, 1, 4, 7];

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
        return isNaN(n) ? 0 : Math.max(1, Math.min(9, n));
    }).filter(n => n > 0);

    if (nums.length === 0) {
        return [1, 5, 3, 5, 1];
    }

    const clamped = nums.slice(0, 9);
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
    const nodesInput = getControl('nodesInput').value;

    const readNumber = (id, fallback) => {
        const value = parseFloat(getControl(id).value);
        return Number.isFinite(value) ? value : fallback;
    };

    config.columnSpacing = readNumber('columnSpacing', 1.0);
    config.rowSpacing = readNumber('rowSpacing', 1.0);
    config.nodeBaseSize = readNumber('nodeBaseSize', 8);
    config.lineThickness = 0.5;
    config.nodeScaleK = 1;
    config.mergeTolerance = 1;
    config.showEdgeNodes = true;
    config.lineColor = '#F3F3F4';
    config.nodeColor = '#F3F3F4';
    config.bgColor = '#0B0B0C';

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
        svgContent += `<line x1="${node1.x}" y1="${node1.y}" x2="${node2.x}" y2="${node2.y}" ` +
            `stroke="${cfg.lineColor}" stroke-width="${cfg.lineThickness}" fill="none" />`;
    }

    for (const inter of intersections) {
        const size = cfg.nodeBaseSize + cfg.nodeScaleK * inter.count;
        if (size > 0) {
            const half = size / 2;
            svgContent += `<rect x="${inter.x - half}" y="${inter.y - half}" ` +
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
            svgContent += `<rect x="${node.x - half}" y="${node.y - half}" ` +
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
        const size = cfg.nodeBaseSize + cfg.nodeScaleK * inter.count;
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

    const svg = `<svg width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" shape-rendering="geometricPrecision">
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
                svgContent += `<line x1="${n1.x}" y1="${n1.y}" x2="${n2.x}" y2="${n2.y}" stroke="currentColor" stroke-opacity="0.42" stroke-width="0.65"/>`;
            }
        }
    }

    // Draw nodes with light gradient color
    for (const col of columns) {
        for (const n of col) {
            svgContent += `<rect x="${n.x - 1.5}" y="${n.y - 1.5}" width="3" height="3" fill="currentColor"/>`;
        }
    }

    return `<svg viewBox="0 0 ${previewSize} ${previewSize}" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`;
}

/**
 * Update stats display
 */
function updateStats(nodeCount, edgeCount, intersectionCount) {
    const formatter = new Intl.NumberFormat('en-US');
    const values = {
        nodes: nodeCount,
        edges: edgeCount,
        intersections: intersectionCount,
    };

    Object.entries(values).forEach(([key, value]) => {
        const output = generatorRoot.querySelector(`[data-stat="${key}"]`);
        if (output) output.textContent = formatter.format(value);
    });

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

    const preview = generatorRoot.querySelector('[data-preview]');
    preview.innerHTML = lastSvg;

    // Apply background to the entire canvas area (not included in SVG export)
    generatorRoot.querySelector('.canvas-area').style.backgroundColor = config.bgColor;

    // Update stats
    updateStats(nodes.length, edges.length, intersections.length);
}

function scheduleRender() {
    if (scheduledRender) return;

    scheduledRender = requestAnimationFrame(() => {
        scheduledRender = null;
        render();
    });
}

function regenerate() {
    const preview = generatorRoot.querySelector('[data-preview]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.clearTimeout(renderAnimationTimer);
    if (reduceMotion) {
        render();
        return;
    }

    preview.classList.add('is-rendering');
    renderAnimationTimer = window.setTimeout(() => {
        render();
        requestAnimationFrame(() => preview.classList.remove('is-rendering'));
    }, 110);
}

function showToast(message) {
    const toast = generatorRoot.querySelector('[data-toast]');
    if (!toast) return;

    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 1800);
}

/**
 * Apply a preset
 */
function applyPreset(index) {
    const preset = presets[index];
    if (!preset) return;

    activePresetIndex = index;

    baseNodesPattern = preset.nodes;
    getControl('nodesInput').value = preset.nodes;
    syncPresetButtons();

    scheduleRender();
}

function syncPresetButtons() {
    generatorRoot.querySelectorAll('[data-preset-index]').forEach((button) => {
        const isActive = Number(button.dataset.presetIndex) === activePresetIndex;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
}

/**
 * Generate random nodes configuration
 */
function randomizeNodes() {
    const numColumns = Math.floor(Math.random() * 7) + 3;
    const nodes = [];
    for (let i = 0; i < numColumns; i++) {
        nodes.push(Math.floor(Math.random() * 9) + 1);
    }
    baseNodesPattern = nodes.join(',');
    getControl('nodesInput').value = baseNodesPattern;

    activePresetIndex = -1;
    syncPresetButtons();

    scheduleRender();
}

// ============================================================================
// Showcase Mode - Hidden feature for recording demos (press 'D' to trigger)
// ============================================================================

let showcaseRunning = false;

// Curated sequence - all shapes share a center point for smooth morphing
const showcaseSequence = [
    '1,3,5,3,1',          // Small diamond
    '1,5,9,5,1',          // Big diamond
    '1,3,5,7,5,3,1',      // Tall diamond
    '1,7,1,7,1',          // Bow tie
    '1,5,1,5,1',          // Small bow
    '1,9,1',              // Burst
    '1,3,5,3,1',          // Back to small diamond
];

/**
 * Compute node positions for morphing
 */
function getNodePositions(nodesPerColumnStr) {
    const nodesPerColumn = parseNodesPerColumn(nodesPerColumnStr);
    const positions = [];
    const innerWidth = config.svgWidth - config.marginLeft - config.marginRight;
    const innerHeight = config.svgHeight - config.marginTop - config.marginBottom;

    nodesPerColumn.forEach((nodeCount, colIndex) => {
        const spacingFraction = nodesPerColumn.length > 1
            ? (colIndex / (nodesPerColumn.length - 1)) * config.columnSpacing
            : 0;
        const colX = config.marginLeft + spacingFraction * innerWidth;

        for (let rowIndex = 0; rowIndex < nodeCount; rowIndex++) {
            let nodeY;
            if (nodeCount === 1) {
                nodeY = config.svgHeight / 2;
            } else {
                const fraction = rowIndex / (nodeCount - 1);
                nodeY = config.marginTop + fraction * config.rowSpacing * innerHeight;
            }
            // Store normalized position for matching
            const colFrac = nodesPerColumn.length > 1 ? colIndex / (nodesPerColumn.length - 1) : 0.5;
            const rowFrac = nodeCount > 1 ? rowIndex / (nodeCount - 1) : 0.5;
            positions.push({ x: colX, y: nodeY, colFrac, rowFrac });
        }
    });
    return positions;
}

/**
 * Start showcase mode - instant cuts through all 8 presets
 */
function startShowcase() {
    if (showcaseRunning) return;
    showcaseRunning = true;

    // Use default settings
    resetToDefaults();
    readControlsToConfig();

    const holdDuration = 225;      // ms to hold each state
    let currentStep = 0;

    function showStep() {
        // Loop back to first preset after going through all
        if (currentStep > presets.length) {
            showcaseRunning = false;
            return;
        }

        // Instant switch - apply preset (handles button state + glow)
        applyPreset(currentStep % presets.length);

        currentStep++;
        setTimeout(showStep, holdDuration);
    }

    showStep();
}

/**
 * Reset all controls to default values
 */
function resetToDefaults() {
    baseNodesPattern = '1,5,3,5,1';
    getControl('nodesInput').value = baseNodesPattern;

    getControl('columnSpacing').value = 1.0;
    getControl('columnSpacingValue').textContent = '1.00';

    getControl('rowSpacing').value = 1.0;
    getControl('rowSpacingValue').textContent = '1.00';

    getControl('nodeBaseSize').value = 8.0;
    getControl('nodeBaseSizeValue').textContent = '8';

    // Update all slider progress bars
    generatorRoot.querySelectorAll('.slider').forEach(updateSliderProgress);

    // Set first preset as active
    applyPreset(0);
}

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

    const label = generatorRoot.querySelector('[data-download-label]');
    if (label) {
        label.textContent = 'SVG saved';
        window.setTimeout(() => { label.textContent = 'Export'; }, 1400);
    }
    showToast('Transparent SVG exported');
}

async function copyGraphic() {
    if (!lastSvg) return;

    const label = generatorRoot.querySelector('[data-copy-label]');

    try {
        const svgBlob = new Blob([lastSvg], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(svgBlob);
        const image = new Image();

        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
            image.src = svgUrl;
        });

        const canvas = document.createElement('canvas');
        const scale = Math.min(4, 1440 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(svgUrl);

        const pngBlob = await new Promise((resolve, reject) => {
            canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG conversion failed')), 'image/png');
        });

        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        if (label) {
            label.textContent = 'Copied';
            window.setTimeout(() => { label.textContent = 'Copy'; }, 1400);
        }
        showToast('Transparent PNG copied');
    } catch (error) {
        try {
            await navigator.clipboard.writeText(lastSvg);
            if (label) {
                label.textContent = 'Copied';
                window.setTimeout(() => { label.textContent = 'Copy'; }, 1400);
            }
            showToast('SVG copied');
        } catch (clipboardError) {
            showToast('Copy is unavailable in this browser');
        }
    }
}

// ============================================================================
// Initialize on Page Load
// ============================================================================

function initializeGenerator() {
    generatorRoot = document.querySelector('[data-tilde-generator]');
    if (!generatorRoot) return;
    if (generatorRoot.dataset.initialized === 'true') return;
    generatorRoot.dataset.initialized = 'true';

    // Generate the complete preset shelf.
    const presetsGrid = generatorRoot.querySelector('[data-presets]');
    presets.forEach((preset, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'preset-button' + (index === 0 ? ' is-active' : '');
        btn.innerHTML = `${generatePresetPreview(preset.nodes)}<span class="preset-name">${preset.name}</span>`;
        btn.dataset.presetIndex = String(index);
        btn.title = preset.name;
        btn.setAttribute('aria-label', `${preset.name} structure`);
        btn.setAttribute('aria-pressed', String(index === 0));
        btn.addEventListener('click', () => {
            applyPreset(index);
            setPresetDrawerOpen(false);
        });
        presetsGrid.appendChild(btn);
    });

    // Keep the four strongest structures immediately available on the canvas.
    const primaryPresets = generatorRoot.querySelector('[data-primary-presets]');
    primaryPresetIndexes.forEach((presetIndex) => {
        const preset = presets[presetIndex];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mode-button' + (presetIndex === 0 ? ' is-active' : '');
        btn.textContent = preset.name;
        btn.dataset.presetIndex = String(presetIndex);
        btn.setAttribute('aria-pressed', String(presetIndex === 0));
        btn.addEventListener('click', () => applyPreset(presetIndex));
        primaryPresets.appendChild(btn);
    });

    generatorRoot.querySelector('[data-action="randomize"]').addEventListener('click', randomizeNodes);
    generatorRoot.querySelector('[data-action="download"]').addEventListener('click', downloadSvg);
    generatorRoot.querySelector('[data-action="copy"]').addEventListener('click', copyGraphic);

    const nodesInput = getControl('nodesInput');
    nodesInput.addEventListener('input', (event) => {
        const digits = event.target.value.replace(/[^1-9]/g, '').slice(0, 9).split('');
        event.target.value = digits.join(',');
        baseNodesPattern = event.target.value;
        activePresetIndex = -1;
        syncPresetButtons();
        scheduleRender();
    });

    generatorRoot.querySelector('[data-action="toggle-presets"]').addEventListener('click', () => {
        const drawer = generatorRoot.querySelector('[data-preset-drawer]');
        setPresetDrawerOpen(drawer.hidden);
    });
    generatorRoot.querySelector('[data-action="close-presets"]').addEventListener('click', () => setPresetDrawerOpen(false));

    // Map of slider IDs to their value display IDs
    const sliderValueMap = {
        'columnSpacing': 'columnSpacingValue',
        'rowSpacing': 'rowSpacingValue',
        'nodeBaseSize': 'nodeBaseSizeValue'
    };

    // Set up sliders
    Object.entries(sliderValueMap).forEach(([sliderId, valueId]) => {
        const slider = getControl(sliderId);
        const valueDisplay = getControl(valueId);

        if (slider && valueDisplay) {
            // Initial progress
            updateSliderProgress(slider);

            slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                valueDisplay.textContent = sliderId === 'nodeBaseSize'
                        ? value.toFixed(value % 1 === 0 ? 0 : 1)
                        : value.toFixed(2);
                updateSliderProgress(slider);
                scheduleRender();
            });
        }
    });

    // Showcase mode - press 'D' to trigger demo animation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setPresetDrawerOpen(false);
        if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Don't trigger if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            startShowcase();
        }
    });

    // Initialize with defaults
    resetToDefaults();
}

function setPresetDrawerOpen(isOpen) {
    const drawer = generatorRoot.querySelector('[data-preset-drawer]');
    const toggle = generatorRoot.querySelector('[data-action="toggle-presets"]');
    drawer.hidden = !isOpen;
    toggle.setAttribute('aria-expanded', String(isOpen));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeGenerator, { once: true });
} else {
    initializeGenerator();
}

})();
