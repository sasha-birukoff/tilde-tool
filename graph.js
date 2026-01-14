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
    bgColor: '#010204',
};

let lastSvg = '';
let lastStats = { nodes: 0, edges: 0, intersections: 0 };
let activePresetIndex = 0;

// Preset configurations
const presets = [
    { name: 'Diamond', nodes: '1,5,3,5,1', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Hourglass', nodes: '5,1,5', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Pyramid', nodes: '1,3,5,7', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Wave', nodes: '3,5,3,5,3', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Funnel', nodes: '7,5,3,1', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Bow', nodes: '4,2,4,2,4', columnSpacing: 1.0, rowSpacing: 1.0 },
    { name: 'Tower', nodes: '1,1,1,1,1,1', columnSpacing: 1.0, rowSpacing: 1.0 },
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

    config.columnSpacing = parseFloat(document.getElementById('columnSpacing').value) || 1.0;
    config.rowSpacing = parseFloat(document.getElementById('rowSpacing').value) || 1.0;
    config.lineThickness = parseFloat(document.getElementById('lineThickness').value) || 0.5;
    config.nodeBaseSize = parseFloat(document.getElementById('nodeBaseSize').value) || 2;
    config.nodeScaleK = parseFloat(document.getElementById('nodeScaleK').value) || 0.4;
    config.mergeTolerance = parseFloat(document.getElementById('mergeTolerance').value) || 1;
    config.showEdgeNodes = document.getElementById('showEdgeNodes').checked;
    config.lineColor = document.getElementById('lineColor').value;
    config.nodeColor = document.getElementById('nodeColor').value;
    config.bgColor = document.getElementById('bgColor').value;

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
    document.getElementById('statNodes').textContent = nodeCount;
    document.getElementById('statEdges').textContent = edgeCount;
    document.getElementById('statIntersections').textContent = intersectionCount;
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

    // Apply background to the entire canvas area (not included in SVG export)
    document.querySelector('.canvas-area').style.backgroundColor = config.bgColor;

    // Update stats
    updateStats(nodes.length, edges.length, intersections.length);
}

/**
 * Apply a preset
 */
function applyPreset(index) {
    const preset = presets[index];
    if (!preset) return;

    activePresetIndex = index;

    // Update nodes input
    document.getElementById('nodesInput').value = preset.nodes;

    // Update spacing if preset has custom values
    if (preset.columnSpacing !== undefined) {
        document.getElementById('columnSpacing').value = preset.columnSpacing;
        document.getElementById('columnSpacingValue').textContent = preset.columnSpacing.toFixed(2);
        updateSliderProgress(document.getElementById('columnSpacing'));
    }
    if (preset.rowSpacing !== undefined) {
        document.getElementById('rowSpacing').value = preset.rowSpacing;
        document.getElementById('rowSpacingValue').textContent = preset.rowSpacing.toFixed(2);
        updateSliderProgress(document.getElementById('rowSpacing'));
    }

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
        nodes.push(Math.floor(Math.random() * 7) + 1); // 1-7 nodes
    }
    document.getElementById('nodesInput').value = nodes.join(',');

    // Clear active preset
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));

    render();
}

/**
 * Reset all controls to default values
 */
function resetToDefaults() {
    document.getElementById('nodesInput').value = '1,5,3,5,1';

    document.getElementById('columnSpacing').value = 1.0;
    document.getElementById('columnSpacingValue').textContent = '1.00';

    document.getElementById('rowSpacing').value = 1.0;
    document.getElementById('rowSpacingValue').textContent = '1.00';

    document.getElementById('lineThickness').value = 0.5;
    document.getElementById('lineThicknessValue').textContent = '0.50';

    document.getElementById('nodeBaseSize').value = 8.0;
    document.getElementById('nodeBaseSizeValue').textContent = '8.00';

    document.getElementById('nodeScaleK').value = 1.0;
    document.getElementById('nodeScaleKValue').textContent = '1.00';

    document.getElementById('mergeTolerance').value = 1;
    document.getElementById('mergeToleranceValue').textContent = '1.00';

    document.getElementById('showEdgeNodes').checked = true;

    document.getElementById('lineColor').value = '#F3F3F4';
    document.getElementById('lineColorHex').value = '#F3F3F4';

    document.getElementById('nodeColor').value = '#F3F3F4';
    document.getElementById('nodeColorHex').value = '#F3F3F4';

    document.getElementById('bgColor').value = '#010204';
    document.getElementById('bgColorHex').value = '#010204';

    // Update all slider progress bars
    document.querySelectorAll('.slider').forEach(updateSliderProgress);

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
}

/**
 * Toggle section expansion
 */
function toggleSection(header) {
    const section = header.closest('.panel-section');
    const content = section.querySelector('.section-content');
    const isExpanded = header.dataset.expanded === 'true';

    header.dataset.expanded = !isExpanded;
    content.classList.toggle('collapsed', isExpanded);
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

    // Set up section headers
    document.querySelectorAll('.section-header').forEach(header => {
        header.addEventListener('click', () => toggleSection(header));
    });

    // Set up color picker and HEX input synchronization
    const colorPairs = [
        { picker: 'lineColor', hex: 'lineColorHex' },
        { picker: 'nodeColor', hex: 'nodeColorHex' },
        { picker: 'bgColor', hex: 'bgColorHex' }
    ];

    colorPairs.forEach(({ picker, hex }) => {
        const pickerElem = document.getElementById(picker);
        const hexElem = document.getElementById(hex);

        pickerElem.addEventListener('input', (e) => {
            hexElem.value = e.target.value.toUpperCase();
            render();
        });

        hexElem.addEventListener('input', (e) => {
            let value = e.target.value.trim();
            if (value && !value.startsWith('#')) {
                value = '#' + value;
            }
            if (/^#[0-9A-F]{6}$/i.test(value)) {
                pickerElem.value = value;
                hexElem.value = value.toUpperCase();
                render();
            }
        });
    });

    // Set up nodes input with auto-comma formatting
    const nodesInput = document.getElementById('nodesInput');
    nodesInput.addEventListener('input', (e) => {
        // Get cursor position before formatting
        const cursorPos = e.target.selectionStart;
        const oldValue = e.target.value;

        // Remove all non-digits, then join with commas
        const digits = oldValue.replace(/[^0-9]/g, '').split('');
        const formatted = digits.join(',');

        // Update value
        e.target.value = formatted;

        // Adjust cursor position (account for added commas)
        const oldCommasBefore = (oldValue.slice(0, cursorPos).match(/,/g) || []).length;
        const digitsTyped = cursorPos - oldCommasBefore;
        const newCursorPos = digitsTyped > 0 ? digitsTyped * 2 - 1 : 0;
        e.target.setSelectionRange(Math.min(newCursorPos + 1, formatted.length), Math.min(newCursorPos + 1, formatted.length));

        // Clear active preset when manually editing
        document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
        render();
    });

    // Set up randomize button
    document.getElementById('randomizeBtn').addEventListener('click', randomizeNodes);

    // Button event listeners
    document.getElementById('resetBtn').addEventListener('click', resetToDefaults);
    document.getElementById('downloadBtn').addEventListener('click', downloadSvg);

    // Map of slider IDs to their value display IDs
    const sliderValueMap = {
        'columnSpacing': 'columnSpacingValue',
        'rowSpacing': 'rowSpacingValue',
        'lineThickness': 'lineThicknessValue',
        'nodeBaseSize': 'nodeBaseSizeValue',
        'nodeScaleK': 'nodeScaleKValue',
        'mergeTolerance': 'mergeToleranceValue'
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
                valueDisplay.textContent = value.toFixed(2);
                updateSliderProgress(slider);
                render();
            });
        }
    });

    // Real-time preview update on control changes
    const controls = ['showEdgeNodes', 'lineColor', 'nodeColor', 'bgColor'];

    controls.forEach(id => {
        const elem = document.getElementById(id);
        if (elem) {
            if (elem.type === 'checkbox') {
                elem.addEventListener('change', render);
            } else {
                elem.addEventListener('input', render);
            }
        }
    });

    // Initialize with defaults
    resetToDefaults();
});
