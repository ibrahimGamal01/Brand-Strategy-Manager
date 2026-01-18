
import os
import sys
import openai

print(f"Python: {sys.version}")
api_key = os.getenv('OPENAI_API_KEY')
print(f"API Key present: {bool(api_key)}")
if api_key:
    print(f"API Key start: {api_key[:5]}...")

try:
    openai.api_key = api_key
    print("Attempting OpenAI call...")
    response = openai.chat.completions.create(
        model='gpt-4o-mini',
        messages=[{'role': 'user', 'content': 'Hello'}],
        max_tokens=5
    )
    print("Success!")
    print(response.choices[0].message.content)
except Exception as e:
    print(f"Error: {e}")
