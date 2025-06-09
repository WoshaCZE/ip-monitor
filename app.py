import os
import csv
import threading
import time
import json
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, session, flash, send_file
from werkzeug.utils import secure_filename
import subprocess

app = Flask(__name__)
app.secret_key = 'change_me'

DATA_DIR = 'projects'
PING_WORKERS = {}


def load_projects():
    if not os.path.isdir(DATA_DIR):
        os.makedirs(DATA_DIR, exist_ok=True)
    return [d for d in os.listdir(DATA_DIR) if os.path.isdir(os.path.join(DATA_DIR, d))]


def load_project_data(project):
    path = os.path.join(DATA_DIR, project, 'data.json')
    if os.path.exists(path):
        with open(path, 'r') as f:
            return json.load(f)
    return {}


def save_project_data(project, data):
    path = os.path.join(DATA_DIR, project)
    os.makedirs(path, exist_ok=True)
    with open(os.path.join(path, 'data.json'), 'w') as f:
        json.dump(data, f)


def parse_csv(path):
    servers = []
    with open(path, newline='') as csvfile:
        reader = csv.reader(csvfile)
        for row in reader:
            if len(row) < 3:
                continue
            servers.append({'name': row[0], 'primary': row[1], 'ipmi': row[2]})
    return servers


def ping_ip(ip):
    if not ip:
        return False
    try:
        result = subprocess.run(['ping', '-c', '1', '-W', '1', ip], stdout=subprocess.DEVNULL)
        return result.returncode == 0
    except Exception:
        return False


class PingWorker(threading.Thread):
    def __init__(self, project, interval=10):
        super().__init__(daemon=True)
        self.project = project
        self.interval = interval
        self.running = False

    def run(self):
        self.running = True
        while self.running:
            data = load_project_data(self.project)
            source = os.path.join(DATA_DIR, self.project, 'source.csv')
            if os.path.exists(source):
                servers = parse_csv(source)
            else:
                servers = []
            now = int(time.time())
            for srv in servers:
                for key in ('primary', 'ipmi'):
                    ip = srv.get(key)
                    if not ip:
                        continue
                    if ping_ip(ip):
                        data.setdefault(ip, {})['last'] = now
            save_project_data(self.project, data)
            time.sleep(self.interval)

    def stop(self):
        self.running = False


@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form.get('username') == 'admin' and request.form.get('password') == 'nejkulatejsikoule':
            session['logged_in'] = True
            return redirect(url_for('dashboard'))
        flash('Invalid credentials')
    return render_template('login.html')


def login_required(func):
    from functools import wraps
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return func(*args, **kwargs)
    return wrapper


@app.route('/dashboard')
@login_required
def dashboard():
    projects = load_projects()
    return render_template('dashboard.html', projects=projects)


@app.route('/add_project', methods=['POST'])
@login_required
def add_project():
    name = request.form.get('project')
    if not name:
        flash('Project name required')
    else:
        path = os.path.join(DATA_DIR, secure_filename(name))
        os.makedirs(path, exist_ok=True)
    return redirect(url_for('dashboard'))


@app.route('/delete_project/<name>', methods=['POST'])
@login_required
def delete_project(name):
    path = os.path.join(DATA_DIR, name)
    if os.path.isdir(path):
        import shutil
        shutil.rmtree(path)
    return redirect(url_for('dashboard'))


@app.route('/project/<name>')
@login_required
def project(name):
    data = load_project_data(name)
    source = os.path.join(DATA_DIR, name, 'source.csv')
    servers = parse_csv(source) if os.path.exists(source) else []
    last = {}
    now = int(time.time())
    for srv in servers:
        for key in ('primary', 'ipmi'):
            ip = srv.get(key)
            if not ip:
                continue
            t = data.get(ip, {}).get('last')
            if t:
                diff = now - t
                if diff < 60:
                    last[ip] = f"{diff}s ago"
                else:
                    last[ip] = f"{diff//60}m ago"
    running = name in PING_WORKERS and PING_WORKERS[name].running
    return render_template('project.html', project=name, servers=servers, last=last, running=running)


@app.route('/project/<name>/upload', methods=['POST'])
@login_required
def upload(name):
    file = request.files.get('file')
    if not file or file.filename == '':
        flash('Please select a file')
        return redirect(url_for('project', name=name))
    filename = secure_filename(file.filename)
    path = os.path.join(DATA_DIR, name)
    os.makedirs(path, exist_ok=True)
    filepath = os.path.join(path, 'source.csv')
    file.save(filepath)
    flash('File uploaded')
    return redirect(url_for('project', name=name))


@app.route('/project/<name>/start')
@login_required
def start_ping(name):
    interval = int(request.args.get('interval', '10'))
    if name in PING_WORKERS:
        worker = PING_WORKERS[name]
        if worker.running:
            flash('Ping already running')
            return redirect(url_for('project', name=name))
        else:
            worker.interval = interval
    else:
        worker = PingWorker(name, interval)
        PING_WORKERS[name] = worker
    worker.start()
    flash('Ping started')
    return redirect(url_for('project', name=name))


@app.route('/project/<name>/stop')
@login_required
def stop_ping(name):
    worker = PING_WORKERS.get(name)
    if worker and worker.running:
        worker.stop()
        flash('Ping stopped')
    return redirect(url_for('project', name=name))


@app.route('/project/<name>/export')
@login_required
def export(name):
    source = os.path.join(DATA_DIR, name, 'source.csv')
    if not os.path.exists(source):
        flash('No file to export')
        return redirect(url_for('project', name=name))
    data = load_project_data(name)
    servers = parse_csv(source)
    out_path = os.path.join(DATA_DIR, name, 'export.csv')
    now = int(time.time())
    with open(out_path, 'w', newline='') as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(['Server', 'Primary IP', 'IPMI IP', 'Last Ping Primary', 'Last Ping IPMI'])
        for srv in servers:
            last_primary = ''
            last_ipmi = ''
            if srv['primary']:
                t = data.get(srv['primary'], {}).get('last')
                if t:
                    diff = now - t
                    last_primary = f"{diff}s" if diff < 60 else f"{diff//60}m"
            if srv['ipmi']:
                t = data.get(srv['ipmi'], {}).get('last')
                if t:
                    diff = now - t
                    last_ipmi = f"{diff}s" if diff < 60 else f"{diff//60}m"
            writer.writerow([srv['name'], srv['primary'], srv['ipmi'], last_primary, last_ipmi])
    return send_file(out_path, as_attachment=True)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')
