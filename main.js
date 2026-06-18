// main.js - 成都地铁+公交混合导航（简化路线显示版）
(function() {
    // ======================= 数据初始化 =======================
    // 创建站点映射表
    const stationMap = new Map();      // key: 站点名称, value: {id, lat, lng, type, name}
    const idToStation = new Map();     // key: 站点id, value: {id, lat, lng, type, name}
    
    // 地铁站点
    window.metroStations.forEach(s => {
        stationMap.set(s.name, { id: s.id, lat: s.lat, lng: s.lng, type: "metro", name: s.name });
        idToStation.set(s.id, { id: s.id, lat: s.lat, lng: s.lng, type: "metro", name: s.name });
    });
    
    // 公交站点
    window.busStationCoordinates.forEach(b => {
        if (!stationMap.has(b.name)) {
            const busId = `B_${b.name.replace(/\s/g, '_')}`;
            stationMap.set(b.name, { id: busId, lat: b.lat, lng: b.lng, type: "bus", name: b.name });
            idToStation.set(busId, { id: busId, lat: b.lat, lng: b.lng, type: "bus", name: b.name });
        }
    });

    // ======================= 构建地铁图 =======================
    function buildMetroGraph() {
        const graph = new Map();
        window.metroStations.forEach(s => graph.set(s.id, []));
        
        function addMetroEdge(fromName, toName, line) {
            const from = stationMap.get(fromName);
            const to = stationMap.get(toName);
            if (!from || !to) return;
            const dist = Math.hypot(from.lat - to.lat, from.lng - to.lng) * 111.2;
            const travel = Math.max(2, Math.round(dist * 1.51 + 0.1));
            const time = travel + 0.7;  // 每站加0.7分钟停站时间
            graph.get(from.id).push({ node: to.id, time, line, type: "metro" });
            graph.get(to.id).push({ node: from.id, time, line, type: "metro" });
        }
        
        for (const [line, stations] of Object.entries(window.metroLineOrders)) {
            for (let i = 0; i < stations.length - 1; i++) {
                addMetroEdge(stations[i], stations[i+1], line);
            }
        }
        return graph;
    }

    // ======================= 构建公交图 =======================
    function buildBusGraph() {
        const graph = new Map();
        
        for (const [lineName, stations] of Object.entries(window.busLineOrders)) {
            for (let i = 0; i < stations.length - 1; i++) {
                const fromNode = stationMap.get(stations[i]);
                const toNode = stationMap.get(stations[i+1]);
                if (!fromNode || !toNode) continue;
                if (fromNode.lat === 0 || toNode.lat === 0) continue; // 跳过无坐标站点
                
                const dist = Math.hypot(fromNode.lat - toNode.lat, fromNode.lng - toNode.lng) * 111.2;
                const time = Math.max(2, Math.round(dist * 3 + 1)); // 公交速度约20km/h + 每站1分钟
                
                if (!graph.has(fromNode.id)) graph.set(fromNode.id, []);
                if (!graph.has(toNode.id)) graph.set(toNode.id, []);
                graph.get(fromNode.id).push({ node: toNode.id, time, line: lineName, type: "bus" });
                graph.get(toNode.id).push({ node: fromNode.id, time, line: lineName, type: "bus" });
            }
        }
        return graph;
    }

    // ======================= 构建步行换乘边 =======================
    function addWalkEdges(graph) {
        const allNodes = Array.from(idToStation.values());
        for (let i = 0; i < allNodes.length; i++) {
            for (let j = i + 1; j < allNodes.length; j++) {
                const a = allNodes[i], b = allNodes[j];
                if (a.type === b.type) continue; // 同类型站点不需要步行边
                if (!graph.has(a.id) || !graph.has(b.id)) continue;
                
                const dist = Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111.2;
                if (dist < 0.8) { // 800米内可步行
                    const walkTime = Math.max(2, Math.round(dist / 5 * 60)); // 步行速度5km/h
                    graph.get(a.id).push({ node: b.id, time: walkTime, line: "步行换乘", type: "walk" });
                    graph.get(b.id).push({ node: a.id, time: walkTime, line: "步行换乘", type: "walk" });
                }
            }
        }
    }

    // ======================= 合并图 =======================
    const metroGraph = buildMetroGraph();
    const busGraph = buildBusGraph();
    const fullGraph = new Map();
    
    // 添加所有节点
    for (let node of metroGraph.keys()) fullGraph.set(node, []);
    for (let node of busGraph.keys()) fullGraph.set(node, []);
    
    // 合并边
    for (let [node, edges] of metroGraph.entries()) fullGraph.get(node).push(...edges);
    for (let [node, edges] of busGraph.entries()) fullGraph.get(node).push(...edges);
    
    // 添加步行换乘边
    addWalkEdges(fullGraph);

    // ======================= Dijkstra 最短路径算法 =======================
    function dijkstra(startId, endId) {
        const distances = new Map(), prev = new Map(), visited = new Set();
        for (let node of fullGraph.keys()) distances.set(node, Infinity);
        distances.set(startId, 0);
        let pq = [{ node: startId, dist: 0 }];
        
        while (pq.length) {
            pq.sort((a, b) => a.dist - b.dist);
            const { node: current, dist: curDist } = pq.shift();
            if (visited.has(current)) continue;
            visited.add(current);
            if (current === endId) break;
            for (const nb of fullGraph.get(current) || []) {
                const nd = curDist + nb.time;
                if (nd < distances.get(nb.node)) {
                    distances.set(nb.node, nd);
                    prev.set(nb.node, { node: current, edge: nb });
                    pq.push({ node: nb.node, dist: nd });
                }
            }
        }
        if (!prev.has(endId) && startId !== endId) return null;
        
        const path = []; let step = endId;
        while (step !== startId) {
            path.unshift(step);
            const p = prev.get(step);
            if (!p) break;
            step = p.node;
        }
        path.unshift(startId);
        
        const segments = [];
        for (let i = 0; i < path.length - 1; i++) {
            const edge = fullGraph.get(path[i])?.find(e => e.node === path[i+1]);
            if (edge) segments.push({ from: path[i], to: path[i+1], time: edge.time, line: edge.line, type: edge.type });
        }
        return { path, totalTime: distances.get(endId), segments };
    }

    // ======================= 简化路线显示（合并同线路连续区间）=======================
    function simplifySegments(segments) {
        if (!segments.length) return [];
        
        const simplified = [];
        let currentLine = segments[0].line;
        let currentType = segments[0].type;
        let startNodeId = segments[0].from;
        let startName = idToStation.get(startNodeId)?.name || "?";
        let accumulatedTime = 0;
        
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const toName = idToStation.get(seg.to)?.name || "?";
            accumulatedTime += seg.time;
            
            // 判断是否线路变化或者是最后一段
            const isLineChange = (seg.line !== currentLine || seg.type !== currentType);
            const isLast = (i === segments.length - 1);
            
            if (isLineChange) {
                // 保存前一段
                const endNodeId = segments[i-1].to;
                const endName = idToStation.get(endNodeId)?.name || "?";
                simplified.push({
                    fromName: startName,
                    toName: endName,
                    line: currentLine,
                    time: accumulatedTime - seg.time,  // 减去当前段的time
                    type: currentType
                });
                // 开始新的一段
                currentLine = seg.line;
                currentType = seg.type;
                startNodeId = seg.from;
                startName = idToStation.get(startNodeId)?.name || "?";
                accumulatedTime = seg.time;
            }
            
            if (isLast) {
                simplified.push({
                    fromName: startName,
                    toName: toName,
                    line: currentLine,
                    time: accumulatedTime,
                    type: currentType
                });
            }
        }
        
        return simplified;
    }

    // ======================= 界面交互 =======================
    function setupSearchable(inputId, suggestionsId) {
        const input = document.getElementById(inputId);
        const suggestionsDiv = document.getElementById(suggestionsId);
        const allNames = Array.from(stationMap.keys()).sort((a, b) => a.localeCompare(b, 'zh'));
        
        input.addEventListener('input', function() {
            const val = this.value.trim();
            if (!val) { suggestionsDiv.style.display = 'none'; return; }
            const filtered = allNames.filter(name => name.includes(val));
            suggestionsDiv.innerHTML = '';
            if (filtered.length === 0) { suggestionsDiv.style.display = 'none'; return; }
            filtered.forEach(name => {
                const div = document.createElement('div');
                const type = stationMap.get(name).type === "metro" ? " 🚇" : " 🚌";
                div.textContent = name + type;
                div.addEventListener('click', () => {
                    input.value = name;
                    suggestionsDiv.style.display = 'none';
                });
                suggestionsDiv.appendChild(div);
            });
            suggestionsDiv.style.display = 'block';
        });
        document.addEventListener('click', (e) => {
            if (e.target !== input && !suggestionsDiv.contains(e.target)) suggestionsDiv.style.display = 'none';
        });
    }

    // ======================= 路线规划主函数 =======================
    function planRoute() {
        const startName = document.getElementById('startInput').value.trim();
        const endName = document.getElementById('endInput').value.trim();
        if (!startName || !endName) {
            document.getElementById('routeContent').innerHTML = "⚠️ 请填写起点和终点";
            return;
        }
        const startNode = stationMap.get(startName);
        const endNode = stationMap.get(endName);
        if (!startNode || !endNode) {
            document.getElementById('routeContent').innerHTML = "❌ 站点不存在，请从下拉列表中选择";
            return;
        }
        if (startNode.id === endNode.id) {
            document.getElementById('routeContent').innerHTML = "📍 起点与终点相同";
            return;
        }
        
        const result = dijkstra(startNode.id, endNode.id);
        if (!result || result.totalTime === Infinity) {
            document.getElementById('routeContent').innerHTML = "😞 未找到可达路线";
            return;
        }
        
        // 简化路线显示
        const simplified = simplifySegments(result.segments);
        const transferCount = simplified.length - 1;
        const totalWithTransfer = result.totalTime + transferCount * 4;
        
        let html = `<div class="time-total">⏱️ 总耗时: ${Math.round(totalWithTransfer)} 分钟</div>`;
        
        for (let i = 0; i < simplified.length; i++) {
            const seg = simplified[i];
            let modeIcon = "";
            if (seg.type === "metro") modeIcon = "🚇地铁";
            else if (seg.type === "bus") modeIcon = "🚌公交";
            else modeIcon = "🚶步行";
            
            html += `<div class="route-step">${seg.fromName} → ${seg.toName}<br><span style="font-size:0.75rem;">${modeIcon} ${seg.line} · ${Math.round(seg.time)}分钟</span></div>`;
            if (i < simplified.length - 1) {
                html += `<div style="font-size:0.7rem; color:#666; text-align:center; margin:4px 0;">⬇️ 换乘 (+4分钟)</div>`;
            }
        }
        html += `<div>✅ 终点: ${endName}</div>`;
        document.getElementById('routeContent').innerHTML = html;
        
        // 在地图上绘制完整路线
        if (routeLayer) routeLayer.clearLayers();
        const coords = [];
        for (const nodeId of result.path) {
            const station = idToStation.get(nodeId);
            if (station) coords.push([station.lat, station.lng]);
        }
        if (coords.length > 1) {
            L.polyline(coords, { color: "#dd3b6e", weight: 5, dashArray: "8,6" }).addTo(routeLayer);
        }
        if (startMarker) map.removeLayer(startMarker);
        if (endMarker) map.removeLayer(endMarker);
        const sc = idToStation.get(startNode.id);
        const ec = idToStation.get(endNode.id);
        if (sc) startMarker = L.marker([sc.lat, sc.lng], { icon: L.divIcon({ html: "⭐", iconSize: [26, 26] }) }).addTo(map).bindPopup("起点");
        if (ec) endMarker = L.marker([ec.lat, ec.lng], { icon: L.divIcon({ html: "🏁", iconSize: [26, 26] }) }).addTo(map).bindPopup("终点");
        if (sc && ec) map.fitBounds([[sc.lat, sc.lng], [ec.lat, ec.lng]], { padding: [60, 60] });
    }

    // ======================= 地图初始化 =======================
    let map, routeLayer, startMarker, endMarker;
    const lineColors = {
        "1号线":"#0033a0","2号线":"#f7941e","3号线":"#e6007e","4号线":"#006633",
        "5号线":"#9b59b6","6号线":"#8B4513","7号线":"#7ec8e0","8号线":"#88b04b",
        "9号线":"#f7d117","10号线":"#00aad2","13号线":"#ff8c00","17号线":"#808080",
        "18号线":"#a0a0a0","19号线":"#dda0dd","27号线":"#20b2aa","30号线":"#cd5c5c"
    };
    
    function initMap() {
        map = L.map('map').setView([30.65, 104.06], 11.5);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '© OSM' }).addTo(map);
        
        // 绘制地铁线路
        for (const [lineName, stations] of Object.entries(window.metroLineOrders)) {
            for (let i = 0; i < stations.length - 1; i++) {
                const fromStation = window.metroStations.find(s => s.name === stations[i]);
                const toStation = window.metroStations.find(s => s.name === stations[i+1]);
                if (fromStation && toStation) {
                    const color = lineColors[lineName] || "#2c7da0";
                    L.polyline([[fromStation.lat, fromStation.lng], [toStation.lat, toStation.lng]], {
                        color: color, weight: 3.5, opacity: 0.85, smoothFactor: 1
                    }).addTo(map);
                }
            }
        }
        
        // 绘制地铁站点
        window.metroStations.forEach(s => {
            L.circleMarker([s.lat, s.lng], { radius: 5, color: "#fff", weight: 1.5, fillColor: "#1f6392", fillOpacity: 0.9 })
                .addTo(map).bindTooltip(s.name + " 🚇", { sticky: true });
        });
        
        // 绘制公交站点
        window.busStationCoordinates.forEach(b => {
            L.circleMarker([b.lat, b.lng], { radius: 3, color: "#e9a23b", weight: 1, fillColor: "#f4b942", fillOpacity: 0.8 })
                .addTo(map).bindTooltip(b.name + " 🚌", { sticky: true });
        });
        
        routeLayer = L.layerGroup().addTo(map);
    }

    // ======================= 启动应用 =======================
    window.addEventListener('load', () => {
        initMap();
        setupSearchable('startInput', 'startSuggestions');
        setupSearchable('endInput', 'endSuggestions');
        document.getElementById('routeBtn').addEventListener('click', planRoute);
        // 默认示例
        setTimeout(() => {
            document.getElementById('startInput').value = "火车南站";
            document.getElementById('endInput').value = "天府广场";
            planRoute();
        }, 500);
    });
})();