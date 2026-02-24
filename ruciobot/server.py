"""
Flask Server Entrypoint for RucioBot Webhooks.
"""
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/webhook", methods=["POST"])
def webhook():
    """
    Handle GitHub Webhooks.
    """
    event = request.headers.get("X-GitHub-Event", "ping")
    print(f"Received event: {event}")
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    app.run(port=3000)
