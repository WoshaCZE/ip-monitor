#!/bin/bash

# ############################################################################
# # Script to Deploy the IP Monitor Static Application with Nginx            #
# ############################################################################

# --- Configuration Variables (Customize these as needed) ---
# Directory where your application files (index.html, login.html, style.css, script.js, lib/) are located locally.
# The script expects to be run from a directory that contains this source folder,
# or you can provide an absolute path.
APP_SOURCE_DIR="ip_monitor_app_files" # Example: ./ip_monitor_app_files

# Target directory on the server where app files will be copied.
# Nginx will serve files from here.
APP_TARGET_DIR="/var/www/html/ipmonitor"

# Server name for Nginx configuration (e.g., your domain or server IP).
# If left empty or as "_", Nginx will use a default server behavior.
NGINX_SERVER_NAME="_" # Replace with your_domain.com or server_ip if desired

# --- Script Execution ---

echo "Starting IP Monitor application deployment..."

# Ensure the script is run as root/sudo
if [[ \$(id -u) -ne 0 ]]; then
  echo "Please run this script with sudo or as root."
  exit 1
fi

# 1. Check if source directory exists
if [ ! -d "\$APP_SOURCE_DIR" ]; then
  echo "Error: Application source directory '\$APP_SOURCE_DIR' not found."
  echo "This directory should be located in the same place as the deploy_ipmonitor.sh script, or an absolute path should be configured in APP_SOURCE_DIR."
  echo "Please create it and place the application files (index.html, login.html, style.css, script.js, lib/ directory) inside."
  exit 1
fi
# Check for essential files in source directory
if [ ! -f "\$APP_SOURCE_DIR/index.html" ] || [ ! -f "\$APP_SOURCE_DIR/login.html" ]; then
  echo "Error: Essential files (index.html, login.html) not found in '\$APP_SOURCE_DIR'."
  exit 1
fi


echo "Step 1: Updating package lists..."
apt update -y

echo "Step 2: Installing Nginx..."
apt install -y nginx
if ! systemctl is-active --quiet nginx; then
    echo "Error: Nginx installation failed or Nginx is not running."
    exit 1
fi

echo "Step 3: Creating target directory '\$APP_TARGET_DIR'..."
mkdir -p "\$APP_TARGET_DIR"

echo "Step 4: Copying application files from '\$APP_SOURCE_DIR' to '\$APP_TARGET_DIR'..."
# Using rsync for better copy, ensures trailing slash logic is handled well for contents.
rsync -av --delete "\$APP_SOURCE_DIR/" "\$APP_TARGET_DIR/"
# cp -r "\$APP_SOURCE_DIR"/* "\$APP_TARGET_DIR/" # Alternative using cp

echo "Step 5: Setting permissions for '\$APP_TARGET_DIR'..."
chown -R www-data:www-data "\$APP_TARGET_DIR"
chmod -R 755 "\$APP_TARGET_DIR"

echo "Step 6: Creating Nginx configuration..."
# Using a variable for server name to handle empty case for default_server
NGINX_LISTEN_CONFIG="listen 80;"
if [ -z "\$NGINX_SERVER_NAME" ] || [ "\$NGINX_SERVER_NAME" == "_" ]; then
  NGINX_LISTEN_CONFIG="listen 80 default_server;"
  ACTUAL_SERVER_NAME_CONFIG="" # No server_name directive for default
else
  ACTUAL_SERVER_NAME_CONFIG="server_name \$NGINX_SERVER_NAME;"
fi

bash -c "cat > /etc/nginx/sites-available/ipmonitor <<EOF
server {
    \${NGINX_LISTEN_CONFIG}
    \${ACTUAL_SERVER_NAME_CONFIG}

    root \${APP_TARGET_DIR};
    index login.html index.html;

    location / {
        try_files \\$uri \\$uri/ /login.html;
    }
}
EOF"

echo "Step 7: Enabling the new Nginx site..."
# Force creation of symlink, overwriting if it exists from a previous run
ln -sfn /etc/nginx/sites-available/ipmonitor /etc/nginx/sites-enabled/ipmonitor

# Optional: Remove the default Nginx site configuration if it exists and is linked
if [ -L /etc/nginx/sites-enabled/default ]; then
  echo "Removing default Nginx site configuration..."
  rm -f /etc/nginx/sites-enabled/default
fi

echo "Step 8: Testing Nginx configuration..."
nginx -t
if [ \$? -ne 0 ]; then
  echo "Error: Nginx configuration test failed. Please check the output above."
  echo "The problematic configuration file is likely /etc/nginx/sites-available/ipmonitor"
  exit 1
fi

echo "Step 9: Restarting Nginx..."
systemctl restart nginx
if ! systemctl is-active --quiet nginx; then
    echo "Error: Nginx failed to restart."
    exit 1
fi

echo ""
echo "---------------------------------------------------------------------"
echo "IP Monitor application deployment completed successfully!"
echo ""
if [ "\$NGINX_SERVER_NAME" == "_" ] || [ -z "\$NGINX_SERVER_NAME" ]; then
  SERVER_IP=\$(hostname -I | awk '{print \$1}')
  echo "You should be able to access the application at: http://\${SERVER_IP}"
  echo "(Using the server's primary IP address as server_name was not specified)"
else
  echo "You should be able to access the application at: http://\${NGINX_SERVER_NAME}"
fi
echo "Make sure your firewall allows traffic on port 80."
echo "---------------------------------------------------------------------"

exit 0
