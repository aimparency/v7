from fastembed import TextEmbedding
from flask import Flask, request, jsonify

# Initialize Flask app
app = Flask(__name__)

# Load the model once at startup and keep it in memory
# bge-small-en-v1.5: 384 dimensions, good quality, fast
model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")

def generate_embedding(text):
    """Generate embedding for a given text."""
    # fastembed returns a generator, get first result
    embedding = list(model.embed([text]))[0]
    return embedding.tolist()

@app.route('/embed', methods=['POST'])
def embed_text():
    """Endpoint to generate embeddings from text."""
    # Expect JSON input with a 'text' field
    data = request.get_json()
    if not data or 'text' not in data:
        print('bad request')
        return jsonify({'error': 'Missing "text" field in JSON request'}), 400
    
    input_text = data['text']
    print('embedding', input_text)
    try:
        embedding = generate_embedding(input_text)
        return jsonify({'embedding': embedding}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Run the server on port 3002
    app.run(host='127.0.0.1', port=3002, debug=False)
