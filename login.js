document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const loginButton = document.getElementById('loginButton');
    const errorMessage = document.getElementById('errorMessage');

    if (loginButton) {
        loginButton.addEventListener('click', (event) => {
            event.preventDefault(); // Prevent default form submission

            const usernameInput = document.getElementById('username');
            const passwordInput = document.getElementById('password');

            const username = usernameInput.value.trim();
            const password = passwordInput.value; // No trim for password

            if (username === "admin" && password === "nejkulatejsikoule") {
                errorMessage.textContent = ""; // Clear any previous error messages
                window.location.href = "index.html";
            } else {
                errorMessage.textContent = "Invalid username or password.";
            }
        });
    } else {
        console.error("Login button not found. Check ID 'loginButton'.");
        if(errorMessage){
            errorMessage.textContent = "Login button could not be found. Please contact support.";
        }
    }

    // Also ensure the form itself doesn't submit and reload the page
    if(loginForm){
        loginForm.addEventListener('submit', (event) => {
            event.preventDefault();
            // The button click handler will manage the logic,
            // but we prevent default here too as a safeguard.
            if(loginButton) { // if button exists, simulate click to trigger logic
                loginButton.click();
            }
        });
    }
});
