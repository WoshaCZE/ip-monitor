document.addEventListener('DOMContentLoaded', () => {
    // --- Global DOM Elements ---
    const projectDashboardDiv = document.getElementById('projectDashboard');
    const newProjectNameInput = document.getElementById('newProjectName');
    const createProjectButton = document.getElementById('createProjectButton');
    const projectListUl = document.getElementById('projectList');

    const projectDetailViewDiv = document.getElementById('projectDetailView');
    const backToDashboardButton = document.getElementById('backToDashboardButton');
    const projectDetailTitle = document.getElementById('projectDetailTitle');

    const fileInput = document.getElementById('fileInput');
    const loadButton = document.getElementById('loadButton');
    const pingIntervalSelect = document.getElementById('pingIntervalSelect');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const exportButton = document.getElementById('exportButton');

    const statusMessage = document.getElementById('statusMessage');
    const resultsTableBody = document.getElementById('resultsTableBody');
    const toastNotification = document.getElementById('toastNotification');

    // --- Global State ---
    let currentProject = null;
    let projects = [];
    let currentProjectData = [];

    let pingIntervalId = null;
    let isPinging = false;
    const PING_RETRY_COUNT = 3;

    const PROJECTS_STORAGE_KEY = "ipMonitorProjects";

    // --- Functions ---

    function saveProjects() {
        localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    }

    function loadProjects() {
        const storedProjects = localStorage.getItem(PROJECTS_STORAGE_KEY);
        if (storedProjects) {
            projects = JSON.parse(storedProjects);
        } else {
            projects = [];
        }
        renderProjectList();
    }

    function renderProjectList() {
        projectListUl.innerHTML = '';
        if (!projects || projects.length === 0) {
            const li = document.createElement('li');
            li.textContent = "No projects yet. Create one!";
            li.style.textAlign = "center";
            li.style.cursor = "default";
            li.style.backgroundColor = "transparent";
            li.style.border = "none";
            projectListUl.appendChild(li);
            return;
        }
        projects.forEach(projectName => {
            const li = document.createElement('li');
            li.textContent = projectName;
            li.dataset.projectName = projectName;
            li.addEventListener('click', () => {
                currentProject = projectName;
                showProjectDetailView();
            });
            projectListUl.appendChild(li);
        });
    }

    function showProjectDashboard() {
        if (isPinging) {
            stopButton.click();
        }
        if (projectDetailViewDiv) projectDetailViewDiv.classList.add('hidden');
        if (projectDashboardDiv) projectDashboardDiv.classList.remove('hidden');
        loadProjects();
        currentProject = null;
        currentProjectData = [];
        if (newProjectNameInput) newProjectNameInput.focus();
        if (statusMessage) statusMessage.textContent = "";
        if (resultsTableBody) resultsTableBody.innerHTML = "";
        if (fileInput) fileInput.value = "";
        if (loadButton) loadButton.disabled = true;
        if (startButton) startButton.disabled = true;
        if (exportButton) exportButton.disabled = true;
        if (stopButton) stopButton.classList.add('hidden');
        if (startButton) startButton.classList.remove('hidden');
        if (pingIntervalSelect) pingIntervalSelect.disabled = false;
    }

    function showProjectDetailView() {
        if (projectDashboardDiv) projectDashboardDiv.classList.add('hidden');
        if (projectDetailViewDiv) projectDetailViewDiv.classList.remove('hidden');

        currentProjectData = [];

        if (projectDetailTitle && currentProject) {
            projectDetailTitle.textContent = `Project: ${currentProject}`;
        } else if (projectDetailTitle) {
            projectDetailTitle.textContent = 'Project: Unknown';
        }

        if (statusMessage) statusMessage.textContent = "Load a CSV/XLSX file to begin.";
        if (resultsTableBody) resultsTableBody.innerHTML = "";
        if (fileInput) fileInput.value = "";

        if (loadButton) loadButton.disabled = true;
        if (startButton) startButton.disabled = true;
        if (exportButton) exportButton.disabled = true;
        if (stopButton) stopButton.classList.add('hidden');
        if (startButton) startButton.classList.remove('hidden');
        if (pingIntervalSelect) pingIntervalSelect.disabled = false;
    }

    function parseCSV(csvData) {
        const lines = csvData.split('\n');
        return lines.map(line => {
            return line.split(',').map(cell => cell.trim());
        });
    }

    function processParsedData(dataArray) {
        if (!dataArray || dataArray.length === 0) {
            return [];
        }
        const dataRows = dataArray.slice(1);

        return dataRows.filter(row => {
            if (!Array.isArray(row) || row.length < 1) return false;
            const serverName = String(row[0] || "").trim();
            const primaryIp = String(row[1] || "").trim();
            const ipmiIp = String(row[2] || "").trim();
            return serverName !== "" && (primaryIp !== "" || ipmiIp !== "");
        }).map(row => {
            return {
                serverName: String(row[0] || "").trim(),
                primaryIp: String(row[1] || "").trim(),
                ipmiIp: String(row[2] || "").trim(),
                primaryLastPing: null,
                ipmiLastPing: null,
                primaryStatus: 'unknown',
                ipmiStatus: 'unknown',
                isEditingPrimary: false,
                isEditingIpmi: false
            };
        });
    }

    function createIpCellContent(cell, ipAddress, rowIndex, ipType) {
        cell.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = ipAddress || "";
        input.dataset.rowIndex = rowIndex;
        input.dataset.ipType = ipType;
        input.readOnly = true;
        if (!ipAddress) input.classList.add('missing-ip');

        const editButton = document.createElement('button');
        editButton.textContent = 'Edit';
        editButton.classList.add('edit-ip-button');
        editButton.dataset.rowIndex = rowIndex;
        editButton.dataset.ipType = ipType;

        const copyButton = document.createElement('button');
        copyButton.textContent = '📋';
        copyButton.classList.add('copy-ip-button');
        copyButton.dataset.rowIndex = rowIndex;
        copyButton.dataset.ipType = ipType;
        copyButton.disabled = !ipAddress;

        cell.appendChild(input);
        cell.appendChild(editButton);
        cell.appendChild(copyButton);
    }

    function formatRelativeTime(timestamp) {
        if (!timestamp) return '-';
        const now = Date.now();
        const seconds = Math.round((now - timestamp) / 1000);
        if (seconds < 5) return "Just now";
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return ">1d ago";
    }

    function checkOverallRowStatus(rowIndex) {
        const item = currentProjectData[rowIndex];
        if (!item) return;
        const primaryPingCell = document.getElementById(`row-${rowIndex}-primary-last-ping`);
        const row = primaryPingCell ? primaryPingCell.closest('tr') : null;
        if (!row) return;

        row.classList.remove('row-ok', 'row-fail-partial', 'row-fail-full');
        const hasPrimary = !!item.primaryIp;
        const hasIpmi = !!item.ipmiIp;
        const primaryOk = item.primaryStatus === 'OK';
        const ipmiOk = item.ipmiStatus === 'OK';

        if (item.serverName && item.serverName.toLowerCase().startsWith('micro')) {
            if ((hasPrimary && !primaryOk) || (hasIpmi && !ipmiOk)) {
                 row.classList.add('row-fail-full');
            }
            return;
        }

        if ((hasPrimary ? primaryOk : true) && (hasIpmi ? ipmiOk : true)) {
            if(hasPrimary || hasIpmi) row.classList.add('row-ok');
        } else if ((hasPrimary && !primaryOk) && (hasIpmi && !ipmiOk)) {
             if(hasPrimary && hasIpmi) row.classList.add('row-fail-full');
             else if (hasPrimary && !primaryOk) row.classList.add('row-fail-full');
             else if (hasIpmi && !ipmiOk) row.classList.add('row-fail-full');
        } else {
            row.classList.add('row-fail-partial');
        }
    }

    function updateRowPingStatusDisplay(rowIndex, ipType, status, lastPingTimestamp) {
        const cellId = `row-${rowIndex}-${ipType}-last-ping`;
        const cell = document.getElementById(cellId);
        if (cell) {
            cell.textContent = lastPingTimestamp ? formatRelativeTime(lastPingTimestamp) : '-';
            cell.className = '';
            if (status === 'OK') cell.classList.add('ping-ok');
            else if (status === 'Fail') cell.classList.add('ping-fail');
            else cell.classList.add('ping-unknown');
            checkOverallRowStatus(rowIndex);
        }
    }

    function updateAllLastPingCells() {
        if (!currentProjectData) return;
        currentProjectData.forEach((item, index) => {
            if (item.primaryIp) {
                updateRowPingStatusDisplay(index, 'primary', item.primaryStatus, item.primaryLastPing);
            } else { // Ensure cell is cleared if IP is removed
                 updateRowPingStatusDisplay(index, 'primary', 'unknown', null);
            }
            if (item.ipmiIp) {
                updateRowPingStatusDisplay(index, 'ipmi', item.ipmiStatus, item.ipmiLastPing);
            } else { // Ensure cell is cleared if IP is removed
                 updateRowPingStatusDisplay(index, 'ipmi', 'unknown', null);
            }
        });
    }

    function populateTable(data) {
        if (resultsTableBody) resultsTableBody.innerHTML = '';

        if (!data || data.length === 0) {
            if (statusMessage) statusMessage.textContent = "No data to display after filtering.";
            if (startButton) startButton.disabled = true;
            if (exportButton) exportButton.disabled = true;
            return;
        }

        data.forEach((item, index) => {
            const row = resultsTableBody.insertRow();
            const serverCell = row.insertCell();
            if (item.serverName && item.serverName.startsWith("DP-")) {
                serverCell.innerHTML = `<a href="https://dapa.datapacket.com/server/${item.serverName.replace(/\s+/g, '')}" target="_blank">${item.serverName}</a>`;
            } else {
                serverCell.textContent = item.serverName;
            }

            const primaryIpCell = row.insertCell();
            createIpCellContent(primaryIpCell, item.primaryIp, index, 'primary');
            const ipmiIpCell = row.insertCell();
            createIpCellContent(ipmiIpCell, item.ipmiIp, index, 'ipmi');

            const primaryLastPingCell = row.insertCell();
            primaryLastPingCell.id = `row-${index}-primary-last-ping`;
            const ipmiLastPingCell = row.insertCell();
            ipmiLastPingCell.id = `row-${index}-ipmi-last-ping`;
        });

        loadPingTimestampsFromLocalStorage();
        updateAllLastPingCells();

        if (statusMessage) statusMessage.textContent = `${data.length} server(s) loaded. Ready to start pinging.`;
        if (startButton) startButton.disabled = false;
        if (exportButton) exportButton.disabled = false; // Enable export if data is loaded
    }

    function getPingDataStorageKey() {
        if (!currentProject) return null;
        return `pingData_${currentProject}`;
    }

    function savePingTimestampsToLocalStorage() {
        const storageKey = getPingDataStorageKey();
        if (!storageKey || !currentProjectData || currentProjectData.length === 0) return;

        const dataToStore = {};
        currentProjectData.forEach(item => {
            if (item.serverName) {
                if (item.primaryIp) { // Only store if primary IP exists
                    dataToStore[`${item.serverName}_primary_lastPing`] = item.primaryLastPing;
                    dataToStore[`${item.serverName}_primary_status`] = item.primaryStatus;
                }
                if (item.ipmiIp) { // Only store if IPMI IP exists
                    dataToStore[`${item.serverName}_ipmi_lastPing`] = item.ipmiLastPing;
                    dataToStore[`${item.serverName}_ipmi_status`] = item.ipmiStatus;
                }
            }
        });
        localStorage.setItem(storageKey, JSON.stringify(dataToStore));
    }

    function loadPingTimestampsFromLocalStorage() {
        const storageKey = getPingDataStorageKey();
        if (!storageKey) return;

        const storedData = localStorage.getItem(storageKey);
        if (storedData) {
            const parsedData = JSON.parse(storedData);
            currentProjectData.forEach(item => {
                if (item.serverName) {
                    const primaryLastPingKey = `${item.serverName}_primary_lastPing`;
                    const primaryStatusKey = `${item.serverName}_primary_status`;
                    const ipmiLastPingKey = `${item.serverName}_ipmi_lastPing`;
                    const ipmiStatusKey = `${item.serverName}_ipmi_status`;

                    if (parsedData[primaryLastPingKey]) {
                        item.primaryLastPing = parsedData[primaryLastPingKey];
                        item.primaryStatus = parsedData[primaryStatusKey] || 'unknown';
                    }
                    if (parsedData[ipmiLastPingKey]) {
                        item.ipmiLastPing = parsedData[ipmiLastPingKey];
                        item.ipmiStatus = parsedData[ipmiStatusKey] || 'unknown';
                    }
                }
            });
        }
    }

    function simulatePing(rowIndex, ipType) {
        if (rowIndex >= currentProjectData.length) return;
        const item = currentProjectData[rowIndex];
        if (!item) return;

        const ipToPing = (ipType === 'primary') ? item.primaryIp : item.ipmiIp;
        if (!ipToPing) {
            updateRowPingStatusDisplay(rowIndex, ipType, 'unknown', null);
            return;
        }

        let success = false;
        for (let i = 0; i < PING_RETRY_COUNT; i++) {
            if (Math.random() > 0.4) {
                success = true;
                break;
            }
        }

        const statusKey = ipType === 'primary' ? 'primaryStatus' : 'ipmiStatus';
        const lastPingKey = ipType === 'primary' ? 'primaryLastPing' : 'ipmiLastPing';

        if (success) {
            item[statusKey] = 'OK';
            item[lastPingKey] = Date.now();
        } else {
            item[statusKey] = 'Fail';
        }
        updateRowPingStatusDisplay(rowIndex, ipType, item[statusKey], item[lastPingKey]);
    }

    function performPingCycle() {
        if (!isPinging || !currentProjectData) return;
        currentProjectData.forEach((item, index) => {
            if (item.primaryIp && !item.isEditingPrimary) {
                simulatePing(index, 'primary');
            }
            if (item.ipmiIp && !item.isEditingIpmi) {
                simulatePing(index, 'ipmi');
            }
        });
    }

    function isValidIp(ipstring) {
        if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipstring)) {
            return true;
        }
        return false;
    }

    function showToast(message) {
        if (!toastNotification) return;
        toastNotification.textContent = message;
        toastNotification.classList.add('show');
        setTimeout(() => {
            toastNotification.classList.remove('show');
        }, 2000);
    }

    function handleEditIpButtonClick(button) {
        const rowIndex = button.dataset.rowIndex;
        const ipType = button.dataset.ipType;
        const input = button.parentElement.querySelector(`input[data-row-index="${rowIndex}"][data-ip-type="${ipType}"]`);
        const item = currentProjectData[rowIndex];

        if (button.textContent === 'Edit') {
            input.readOnly = false;
            input.classList.add('editing-ip');
            button.textContent = '✓ OK';
            button.classList.remove('edit-ip-button');
            button.classList.add('save-ip-button');
            input.focus();
            if (ipType === 'primary') item.isEditingPrimary = true; else item.isEditingIpmi = true;
        } else {
            const newIpValue = input.value.trim();
            input.readOnly = true;
            input.classList.remove('editing-ip');
            button.textContent = 'Edit';
            button.classList.remove('save-ip-button');
            button.classList.add('edit-ip-button');

            const ipKey = ipType === 'primary' ? 'primaryIp' : 'ipmiIp';
            currentProjectData[rowIndex][ipKey] = newIpValue;

            if (newIpValue) input.classList.remove('missing-ip');
            else input.classList.add('missing-ip');

            const copyButton = button.parentElement.querySelector('.copy-ip-button');
            if(copyButton) copyButton.disabled = !newIpValue;

            if (ipType === 'primary') item.isEditingPrimary = false; else item.isEditingIpmi = false;

            if (isPinging && newIpValue) {
                 simulatePing(rowIndex, ipType);
            } else if (!newIpValue) {
                const statusKey = ipType === 'primary' ? 'primaryStatus' : 'ipmiStatus';
                const lastPingKey = ipType === 'primary' ? 'primaryLastPing' : 'ipmiLastPing';
                item[statusKey] = 'unknown';
                item[lastPingKey] = null;
                updateRowPingStatusDisplay(rowIndex, ipType, item[statusKey], item[lastPingKey]);
            }
            showToast(`IP for row ${parseInt(rowIndex) + 1} (${ipType}) updated.`);
        }
    }

    function handleCopyIpButtonClick(button) {
        const rowIndex = button.dataset.rowIndex;
        const ipType = button.dataset.ipType;
        const input = button.parentElement.querySelector(`input[data-row-index="${rowIndex}"][data-ip-type="${ipType}"]`);
        const ipToCopy = input.value;

        if (ipToCopy && navigator.clipboard) {
            navigator.clipboard.writeText(ipToCopy).then(() => {
                showToast('IP copied to clipboard!');
            }).catch(err => {
                showToast('Failed to copy IP.');
                console.error('Copy failed:', err);
            });
        } else if (!ipToCopy) {
            showToast('No IP to copy.');
        } else {
            try {
                input.select();
                document.execCommand('copy');
                showToast('IP copied (fallback method)!');
            } catch (err) {
                showToast('Clipboard API not available and fallback failed.');
                console.error('Fallback copy failed:', err);
            }
        }
    }

    // --- Event Listeners ---
    if (resultsTableBody) {
        resultsTableBody.addEventListener('click', (event) => {
            if (event.target.classList.contains('edit-ip-button') || event.target.classList.contains('save-ip-button')) {
                handleEditIpButtonClick(event.target);
            } else if (event.target.classList.contains('copy-ip-button')) {
                handleCopyIpButtonClick(event.target);
            }
        });
    }

    if (startButton) {
        startButton.addEventListener('click', () => {
            isPinging = true;
            startButton.classList.add('hidden');
            stopButton.classList.remove('hidden');
            if (loadButton) loadButton.disabled = true;
            if (fileInput) fileInput.disabled = true;
            if (pingIntervalSelect) pingIntervalSelect.disabled = true;
            if (exportButton) exportButton.disabled = true; // Disable export during ping

            loadPingTimestampsFromLocalStorage();
            updateAllLastPingCells();
            performPingCycle();
            pingIntervalId = setInterval(performPingCycle, parseInt(pingIntervalSelect.value));
        });
    }

    if (stopButton) {
        stopButton.addEventListener('click', () => {
            isPinging = false;
            stopButton.classList.add('hidden');
            startButton.classList.remove('hidden');
            if (fileInput && fileInput.files && fileInput.files.length > 0) {
                 if(loadButton) loadButton.disabled = false;
            } else {
                 if(loadButton) loadButton.disabled = true;
            }
            if (fileInput) fileInput.disabled = false;
            if (pingIntervalSelect) pingIntervalSelect.disabled = false;
            if (exportButton) exportButton.disabled = !currentProjectData || currentProjectData.length === 0;


            clearInterval(pingIntervalId);
            pingIntervalId = null;
            savePingTimestampsToLocalStorage();
        });
    }

    if(pingIntervalSelect) {
        pingIntervalSelect.addEventListener('change', () => {
            if (isPinging) {
                clearInterval(pingIntervalId);
                pingIntervalId = setInterval(performPingCycle, parseInt(pingIntervalSelect.value));
                showToast(`Ping interval changed to ${pingIntervalSelect.options[pingIntervalSelect.selectedIndex].text}.`);
            }
        });
    }

    if (exportButton) {
        exportButton.addEventListener('click', () => {
            if (!currentProjectData || currentProjectData.length === 0) {
                showToast("No data to export.");
                return;
            }

            const dataForExport = [];
            dataForExport.push(["Server Name", "Primary IP", "IPMI IP", "Primary Last Ping (s ago)", "IPMI Last Ping (s ago)", "Primary Status", "IPMI Status"]);

            currentProjectData.forEach(item => {
                const primaryLastPingSeconds = item.primaryLastPing ? Math.round((Date.now() - item.primaryLastPing) / 1000) : "N/A";
                const ipmiLastPingSeconds = item.ipmiLastPing ? Math.round((Date.now() - item.ipmiLastPing) / 1000) : "N/A";
                dataForExport.push([
                    item.serverName,
                    item.primaryIp,
                    item.ipmiIp,
                    primaryLastPingSeconds,
                    ipmiLastPingSeconds,
                    item.primaryIp ? item.primaryStatus : "N/A", // Add status only if IP exists
                    item.ipmiIp ? item.ipmiStatus : "N/A"
                ]);
            });

            const worksheet = XLSX.utils.aoa_to_sheet(dataForExport);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Ping Report");

            const now = new Date();
            const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
            const filename = `${currentProject || 'General'}-ping-report-${timestamp}.xlsx`;

            try {
                XLSX.writeFile(workbook, filename);
                showToast("Exporting data...");
            } catch (err) {
                showToast("Error exporting data. See console.");
                console.error("Export error:", err);
            }
        });
    }

    if (createProjectButton) {
        createProjectButton.addEventListener('click', () => {
            const projectName = newProjectNameInput.value.trim();
            if (projectName === "") {
                alert("Project name cannot be empty.");
                return;
            }
            if (projects.includes(projectName)) {
                alert("Project name already exists. Please choose a different name.");
                return;
            }
            projects.push(projectName);
            saveProjects();
            renderProjectList();
            newProjectNameInput.value = '';
            newProjectNameInput.focus();
        });
    }

    if (backToDashboardButton) {
        backToDashboardButton.addEventListener('click', () => {
            showProjectDashboard();
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files.length > 0) {
                if (loadButton) loadButton.disabled = false;
                if (statusMessage) statusMessage.textContent = `File selected: ${fileInput.files[0].name}. Click 'Load CSV/XLSX'.`;
                if (startButton) startButton.disabled = true;
                if (exportButton) exportButton.disabled = true;
                if (resultsTableBody) resultsTableBody.innerHTML = "";
            } else {
                if (loadButton) loadButton.disabled = true;
                if (statusMessage) statusMessage.textContent = "Load a CSV/XLSX file to begin.";
            }
        });
    }

    if (loadButton) {
        loadButton.addEventListener('click', () => {
            const file = fileInput.files[0];
            if (!file) {
                if (statusMessage) statusMessage.textContent = "No file selected. Please select a CSV or XLSX file.";
                return;
            }

            if (loadButton) loadButton.disabled = true;
            if (startButton) startButton.disabled = true;
            if (exportButton) exportButton.disabled = true;
            if (statusMessage) statusMessage.textContent = "Processing file...";

            const reader = new FileReader();
            const fileName = file.name.toLowerCase();

            reader.onload = (event) => {
                try {
                    let rawData;
                    if (fileName.endsWith(".csv")) {
                        rawData = parseCSV(event.target.result);
                    } else if (fileName.endsWith(".xlsx")) {
                        const arrayBuffer = event.target.result;
                        const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
                        const firstSheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[firstSheetName];
                        rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                    } else {
                        throw new Error("Unsupported file type. Please use CSV or XLSX.");
                    }

                    currentProjectData = processParsedData(rawData);
                    populateTable(currentProjectData);

                } catch (error) {
                    console.error("Error processing file:", error);
                    if (statusMessage) statusMessage.textContent = `Error: ${error.message}`;
                    currentProjectData = [];
                    populateTable(currentProjectData);
                } finally {
                     if (fileInput.files && fileInput.files.length > 0) {
                        if (loadButton) loadButton.disabled = false;
                    } else {
                        if (loadButton) loadButton.disabled = true;
                    }
                }
            };

            reader.onerror = () => {
                console.error("FileReader error.");
                if (statusMessage) statusMessage.textContent = "Error reading file.";
                if (loadButton) loadButton.disabled = false;
                currentProjectData = [];
                populateTable(currentProjectData);
                if (fileInput) fileInput.value = "";
            };

            if (fileName.endsWith(".csv")) {
                reader.readAsText(file);
            } else if (fileName.endsWith(".xlsx")) {
                reader.readAsArrayBuffer(file);
            } else {
                if (statusMessage) statusMessage.textContent = "Unsupported file type. Please select a CSV or XLSX file.";
                if (loadButton) loadButton.disabled = false;
                if (fileInput) fileInput.value = "";
            }
        });
    }

    window.addEventListener('beforeunload', () => {
        if (isPinging) {
            savePingTimestampsToLocalStorage();
        }
    });

    // --- Initial Setup ---
    showProjectDashboard();
});
