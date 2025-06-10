import os
import time
import threading
import subprocess
import ping3
from datetime import datetime
from flask import Flask, render_template, request, redirect, jsonify, send_file
import pandas as pd
from werkzeug.utils import secure_filename

app = Flask(__name__)
UPLOAD_FOLDER = os.path.join(app.root_path, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Shared state
data_lock = threading.Lock()
servers = []  # list of dicts with keys: name, primary_ip, ipmi_ip, last_primary, last_ipmi, primary_up, ipmi_up
original_df = None
source_file = None

ping_interval = 5
ping_running = False
ping_thread = None


def load_file(path):
    global servers, original_df, source_file
    if path.lower().endswith('.csv'):
        df = pd.read_csv(path)
    else:
        df = pd.read_excel(path)
    original_df = df.copy()
    source_file = path
    temp = []
    for _, row in df.iterrows():
        name = str(row.iloc[0]) if not pd.isna(row.iloc[0]) else ''
        primary = str(row.iloc[1]) if len(row) > 1 and not pd.isna(row.iloc[1]) else ''
        ipmi = str(row.iloc[2]) if len(row) > 2 and not pd.isna(row.iloc[2]) else ''
        temp.append({
            'name': name,
            'primary_ip': primary,
            'ipmi_ip': ipmi,
            'last_primary': None,
            'last_ipmi': None,
            'primary_up': None,
            'ipmi_up': None
        })
    with data_lock:
        servers = temp


def allowed_to_ping(name):
    return name.startswith('DP') or name.startswith('CDN77')

app.jinja_env.globals.update(allowed_to_ping=allowed_to_ping)


def ping_ip(ip):
    """Return True if the IP responds to a quick ping."""
    try:
        return ping3.ping(ip, timeout=1) is not None
    except Exception:
        return False


def ping_worker():
    global ping_running
    while ping_running:
        now = time.time()
        with data_lock:
            current = list(enumerate(servers))
            interval = ping_interval
        # ping primary IPs in groups of 10
        primaries = [(i, s['primary_ip']) for i, s in current if s['primary_ip'] and allowed_to_ping(s['name'])]
        for start in range(0, len(primaries), 10):
            group = primaries[start:start+10]
            threads = []
            for idx, ip in group:
                t = threading.Thread(target=ping_primary, args=(idx, ip))
                t.start()
                threads.append(t)
            for t in threads:
                t.join()
        # ping IPMI IPs once per minute
        for idx, s in current:
            ip = s['ipmi_ip']
            if ip and allowed_to_ping(s['name']):
                last = s['last_ipmi']
                if not last or time.time() - last >= 60:
                    success = ping_ip(ip)
                    with data_lock:
                        servers[idx]['ipmi_up'] = success
                        if success:
                            servers[idx]['last_ipmi'] = time.time()
        # sleep according to interval
        for _ in range(interval):
            if not ping_running:
                break
            time.sleep(1)


def ping_primary(idx, ip):
    success = ping_ip(ip)
    with data_lock:
        servers[idx]['primary_up'] = success
        if success:
            servers[idx]['last_primary'] = time.time()


@app.route('/')
def index():
    with data_lock:
        data = list(servers)
    return render_template('index.html', servers=data, running=ping_running, interval=ping_interval)


@app.route('/upload', methods=['POST'])
def upload():
    file = request.files.get('file')
    if not file or file.filename == '':
        return 'No file selected', 400
    filename = secure_filename(file.filename)
    path = os.path.join(UPLOAD_FOLDER, filename)
    file.save(path)
    load_file(path)
    return redirect('/')


@app.route('/start_ping', methods=['POST'])
def start_ping():
    global ping_running, ping_thread, ping_interval
    interval = int(request.form.get('interval', 5))
    ping_interval = interval
    if not ping_running:
        ping_running = True
        ping_thread = threading.Thread(target=ping_worker, daemon=True)
        ping_thread.start()
    return ('', 204)


@app.route('/stop_ping', methods=['POST'])
def stop_ping():
    global ping_running
    ping_running = False
    return ('', 204)


@app.route('/status')
def status():
    now = time.time()
    with data_lock:
        data = []
        for s in servers:
            lp = int(now - s['last_primary']) if s['last_primary'] else None
            li = int(now - s['last_ipmi']) if s['last_ipmi'] else None
            data.append({
                'name': s['name'],
                'primary_ip': s['primary_ip'],
                'ipmi_ip': s['ipmi_ip'],
                'last_primary': lp,
                'last_ipmi': li,
                'primary_up': s['primary_up'],
                'ipmi_up': s['ipmi_up']
            })
    return jsonify(data)


@app.route('/update_ip', methods=['POST'])
def update_ip():
    idx = int(request.form['index'])
    field = request.form['field']  # 'primary' or 'ipmi'
    value = request.form['value']
    with data_lock:
        if 0 <= idx < len(servers):
            if field == 'primary':
                servers[idx]['primary_ip'] = value
                servers[idx]['last_primary'] = None
                servers[idx]['primary_up'] = None
            else:
                servers[idx]['ipmi_ip'] = value
                servers[idx]['last_ipmi'] = None
                servers[idx]['ipmi_up'] = None
    return ('', 204)


@app.route('/export')
def export():
    if original_df is None:
        return 'No data', 400
    df = original_df.copy()
    with data_lock:
        prim = [s['last_primary'] for s in servers]
        ipmi = [s['last_ipmi'] for s in servers]
    df['Last Ping Primary IP'] = [datetime.fromtimestamp(p).isoformat() if p else '' for p in prim]
    df['Last Ping IPMI IP'] = [datetime.fromtimestamp(p).isoformat() if p else '' for p in ipmi]
    out_path = os.path.join(UPLOAD_FOLDER, os.path.splitext(os.path.basename(source_file))[0] + '_export.csv')
    df.to_csv(out_path, index=False)
    return send_file(out_path, as_attachment=True)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
