# Suno V6 Kie.ai MCP

MCP server ringan untuk membuat lagu atau musik menggunakan **Suno V6**, **V6_MINI**, dan **V6_WILD** melalui API resmi Kie.ai. Server mendukung stdio untuk MCP client lokal dan Streamable HTTP untuk Manus Custom MCP Connector.

## Fitur

- `suno_generate_music` untuk membuat lagu vokal atau instrumental.
- `suno_get_task_status` untuk mengambil status dan URL audio hasil generate.
- Dukungan `V6`, `V6_MINI`, dan `V6_WILD`.
- Dukungan `duration` 10–360 detik pada custom mode.
- Tidak menyimpan API key atau hasil audio ke database.
- HTTP endpoint `/mcp` dan health check `/health`.

## Persiapan

Gunakan Node.js 20 atau lebih baru dan API key dari [Kie.ai API Key](https://kie.ai/api-key).

```bash
git clone https://github.com/xaxeane/suno-v6-kie-mcp.git
cd suno-v6-kie-mcp
npm install
npm run build
```

## Menjalankan sebagai MCP lokal (stdio)

```bash
KIE_AI_API_KEY="YOUR_KIE_API_KEY" npm start
```

Contoh konfigurasi MCP client yang mendukung command lokal:

```json
{
  "mcpServers": {
    "suno-v6-kie": {
      "command": "node",
      "args": ["/absolute/path/to/suno-v6-kie-mcp/dist/index.js"],
      "env": {
        "KIE_AI_API_KEY": "YOUR_KIE_API_KEY"
      }
    }
  }
}
```

## Menjalankan sebagai remote MCP untuk Manus

Remote deployment diperlukan karena Manus Custom MCP Connector membutuhkan endpoint HTTPS yang dapat diakses Manus.

```bash
KIE_AI_API_KEY="YOUR_KIE_API_KEY" \
KIE_MCP_HTTP_TOKEN="GENERATED_MCP_TOKEN" \
MCP_TRANSPORT=http \
MCP_HTTP_HOST=0.0.0.0 \
MCP_HTTP_PORT=3000 \
MCP_ALLOWED_HOSTS="mcp.example.com" \
npm start
```

Gunakan reverse proxy/TLS sehingga endpoint publik menjadi:

```text
https://mcp.example.com/mcp
```

Set header autentikasi pada connector Manus:

```text
Authorization: Bearer GENERATED_MCP_TOKEN
```

`KIE_AI_API_KEY` hanya disimpan di environment server dan tidak dikirim ke Manus.

### Docker

```bash
docker build -t suno-v6-kie-mcp .
docker run -d --name suno-v6-kie-mcp \
  -p 3000:3000 \
  -e KIE_AI_API_KEY="YOUR_KIE_API_KEY" \
  -e KIE_MCP_HTTP_TOKEN="GENERATED_MCP_TOKEN" \
  -e MCP_TRANSPORT=http \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_ALLOWED_HOSTS="mcp.example.com" \
  suno-v6-kie-mcp
```

Setelah service aktif, buka Manus → **Connectors** → **Add connector** → **Custom MCP**, masukkan URL `/mcp`, tambahkan header Bearer token, lalu aktifkan connector.

## Contoh penggunaan

```json
{
  "prompt": "Cinematic Indonesian pop song about chasing dreams under the city lights",
  "customMode": false,
  "instrumental": false,
  "model": "V6"
}
```

Untuk custom mode:

```json
{
  "prompt": "Langit malam menjadi saksi langkah kita\nTakkan menyerah mengejar cahaya",
  "customMode": true,
  "instrumental": false,
  "model": "V6_WILD",
  "style": "Indonesian cinematic pop, emotional female vocal, orchestral chorus",
  "title": "Mengejar Cahaya",
  "duration": 180
}
```

Setelah menerima `task_id`, panggil `suno_get_task_status` dengan:

```json
{ "taskId": "TASK_ID_DARI_RESPONSE" }
```

Status yang umum: `waiting`, `queuing`, `generating`, `success`, atau `fail`. URL audio tersedia pada `result` ketika task berhasil.

## Environment variables

| Variable | Wajib | Keterangan |
| --- | --- | --- |
| `KIE_AI_API_KEY` | Ya | Bearer API key Kie.ai |
| `KIE_AI_BASE_URL` | Tidak | Default `https://api.kie.ai` |
| `MCP_TRANSPORT` | Tidak | `http` untuk remote MCP; default stdio |
| `MCP_HTTP_HOST` | Tidak | Default `127.0.0.1` |
| `MCP_HTTP_PORT` | Tidak | Default `3000` |
| `KIE_MCP_HTTP_TOKEN` | Remote | Bearer token untuk client MCP |
| `MCP_ALLOWED_HOSTS` | Remote | Host/domain publik yang diizinkan |

## Keamanan

Gunakan HTTPS pada deployment publik, token MCP acak, dan jangan commit file `.env` atau API key. Kie.ai mengenakan biaya/kredit sesuai akun dan model yang digunakan; server ini tidak melakukan approval billing di luar alur MCP client.

## Lisensi

MIT
