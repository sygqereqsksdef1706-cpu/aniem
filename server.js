import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// --- HELPER: AMBIL DETAIL & TERJEMAHAN DARI ANILIST ---
async function getAnilistInfo(title) {
    try {
        const query = `
            query ($search: String!) {
              Page (perPage: 1) {
                media(search: $search, type: ANIME) {
                  id
                  title { romaji english native }
                  synonyms
                  averageScore
                  seasonYear
                  genres
                  description(asHtml: false)
                  coverImage { large }
                }
              }
            }
        `;
        const res = await axios.post('https://graphql.anilist.co', {
            query,
            variables: { search: title }
        });
        
        const media = res.data.data.Page.media[0];
        if (!media) return null;

        let description = media.description ? media.description.replace(/<[^>]*>/g, "") : "Tidak ada sinopsis.";
        
        // Terjemahan otomatis sinopsis ke Bahasa Indonesia
        try {
            const transRes = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=id&dt=t&q=${encodeURIComponent(description)}`);
            if (transRes.data && transRes.data[0]) {
                description = transRes.data[0].map(item => item[0]).join('');
            }
        } catch (e) {
            // Abaikan jika gagal terjemah
        }

        return {
            score: media.averageScore ? (media.averageScore / 10).toFixed(1) : '-',
            year: media.seasonYear || '-',
            genres: media.genres || [],
            description: description,
            coverImage: media.coverImage?.large || ''
        };
    } catch (error) {
        return null;
    }
}

// 1. Endpoint Home / Search
app.get('/api/search', async (req, res) => {
    const query = req.query.q || '';
    try {
        const url = query ? `https://stenly.org/api/samehadaku?q=${encodeURIComponent(query)}` : 'https://stenly.org/api/samehadaku';
        const response = await axios.get(url, { headers: { 'Cache-Control': 'no-cache' } });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil data' });
    }
});

// 2. Endpoint Detail Anime
app.get('/api/detail', async (req, res) => {
    try {
        const targetUrl = req.query.url;
        const response = await axios.get(`https://stenly.org/api/samehadaku/detail?url=${encodeURIComponent(targetUrl)}`, { headers: { 'Cache-Control': 'no-cache' } });
        
        let data = response.data;
        let d = data.Result || data;

        if (d.title) {
            const extraInfo = await getAnilistInfo(d.title);
            if (extraInfo) {
                d.score = extraInfo.score;
                d.year = extraInfo.year;
                d.genres = extraInfo.genres;
                d.synopsis = extraInfo.description;
                if (!d.thumbnail && extraInfo.coverImage) d.thumbnail = extraInfo.coverImage;
            }
        }

        res.json({ Result: d });
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil detail' });
    }
});

// 3. Endpoint Ekstraksi Video
app.get('/api/get-video', async (req, res) => {
    const episodeUrl = req.query.url;
    try {
        const { data: html } = await axios.get(episodeUrl, {
            headers: {
                'Referer': 'https://samehadaku.li/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const $ = cheerio.load(html);
        let videoSrc = '';

        const bloggerMatch = html.match(/https:\/\/(?:www\.|draft\.)?blogger\.com\/video\.g\?token=[^\s"']+/);
        if (bloggerMatch) videoSrc = bloggerMatch[0];

        if (!videoSrc) {
            $('iframe').each((i, el) => {
                const src = $(el).attr('src') || $(el).attr('data-src') || '';
                if (src.includes('blogger.com') || src.includes('googleusercontent')) videoSrc = src;
            });
        }

        if (!videoSrc) {
            const turbovidMatch = html.match(/https:\/\/(?:www\.)?turbovidhls\.com\/t\/[a-zA-Z0-9]+/);
            if (turbovidMatch) videoSrc = turbovidMatch[0];
        }

        if (!videoSrc) videoSrc = $('iframe').first().attr('src') || '';

        if (videoSrc) {
            res.json({ success: true, url: videoSrc });
        } else {
            res.status(404).json({ success: false, message: 'Link video tidak ditemukan.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 4. Frontend Web (ANIMEX)
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ANIMEX - Streaming Anime Minimalis</title>
    <style>
        :root {
            --bg-color: #050507;
            --card-bg: #101218;
            --primary: #ff334b;
            --primary-hover: #ff1a35;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --border-color: #1a1d26;
        }
        body { background: var(--bg-color); color: var(--text-main); font-family: 'Inter', -apple-system, sans-serif; margin: 0; padding: 0; }
        
        header { 
            background: rgba(5, 5, 7, 0.9);
            backdrop-filter: blur(10px);
            position: sticky;
            top: 0;
            z-index: 100;
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            padding: 16px 5%; 
            border-bottom: 1px solid var(--border-color);
        }
        .logo-area h1 { color: var(--primary); margin: 0; font-size: 24px; font-weight: 900; letter-spacing: 1px; cursor: pointer; }
        
        .search-box { display: flex; gap: 8px; background: #0d0f14; padding: 4px 10px; border-radius: 30px; border: 1px solid var(--border-color); transition: border-color 0.2s; }
        .search-box:focus-within { border-color: var(--primary); }
        input { padding: 8px; width: 200px; border: none; background: transparent; color: #fff; font-size: 14px; outline: none; }
        input::placeholder { color: var(--text-muted); }
        .search-btn { background: var(--primary); color: white; border: none; border-radius: 20px; padding: 6px 16px; font-weight: 600; font-size: 13px; cursor: pointer; transition: background 0.2s; }
        .search-btn:hover { background: var(--primary-hover); }

        .container { max-width: 1300px; margin: 0 auto; padding: 30px 5%; }
        .section-title { font-size: 16px; font-weight: 700; margin-bottom: 20px; color: #cbd5e1; letter-spacing: 0.5px; text-transform: uppercase; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 20px; }
        .card { 
            background: var(--card-bg); 
            border-radius: 10px; 
            overflow: hidden; 
            cursor: pointer; 
            transition: transform 0.25s ease, box-shadow 0.25s ease; 
            border: 1px solid var(--border-color);
            position: relative;
        }
        .card:hover { 
            transform: translateY(-5px); 
            box-shadow: 0 10px 25px rgba(255, 51, 75, 0.15); 
            border-color: rgba(255, 51, 75, 0.3); 
        }
        .card-img-wrapper { position: relative; width: 100%; height: 240px; overflow: hidden; background: #000; }
        .card img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s ease; }
        .card:hover img { transform: scale(1.05); }
        
        .ep-badge {
            position: absolute;
            top: 8px;
            right: 8px;
            background: rgba(5, 5, 7, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: var(--text-main);
            font-size: 11px;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 4px;
            backdrop-filter: blur(4px);
        }

        .card-content { padding: 12px; }
        .card p { font-size: 13px; font-weight: 600; margin: 0; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: #e2e8f0; }

        #detail-section, #player-section { display: none; max-width: 900px; margin: 10px auto; background: var(--card-bg); padding: 25px; border-radius: 12px; border: 1px solid var(--border-color); }
        .detail-header { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
        .detail-header img { width: 180px; height: 260px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border-color); }
        .detail-info { flex: 1; min-width: 240px; }
        .detail-info h2 { margin-top: 0; font-size: 24px; color: #fff; }
        
        .badges-row { display: flex; gap: 10px; margin: 10px 0; flex-wrap: wrap; }
        .badge { background: #1a1d26; border: 1px solid var(--border-color); padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; color: #38bdf8; }
        .badge-score { color: #facc15; }

        .genre-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
        .genre-tag { background: #161922; color: var(--text-muted); padding: 3px 8px; border-radius: 4px; font-size: 11px; border: 1px solid var(--border-color); }

        .synopsis-box { margin-top: 15px; font-size: 13px; color: var(--text-muted); line-height: 1.6; background: #0d0f14; padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); }

        .back-btn { background: #161922; color: #cbd5e1; border: 1px solid var(--border-color); margin-bottom: 20px; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; transition: background 0.2s; }
        .back-btn:hover { background: #222634; color: #fff; }
        
        .latest-ep-box { background: linear-gradient(135deg, #1f1418, #101218); border: 1px solid rgba(255, 51, 75, 0.4); padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; gap: 15px; }
        .latest-ep-box span { font-size: 13px; font-weight: 600; color: #f8fafc; }
        .watch-latest-btn { background: var(--primary); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px; white-space: nowrap; transition: background 0.2s; }
        .watch-latest-btn:hover { background: var(--primary-hover); }

        .ep-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin-top: 15px; max-height: 350px; overflow-y: auto; padding-right: 4px; }
        .ep-btn { background: #161922; border: 1px solid var(--border-color); color: #cbd5e1; padding: 10px; border-radius: 6px; cursor: pointer; text-align: center; font-size: 12px; font-weight: 500; transition: all 0.2s; }
        .ep-btn:hover { background: var(--primary); border-color: var(--primary); color: #fff; }

        .player-wrapper { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 8px; background: #000; margin-top: 15px; border: 1px solid var(--border-color); }
        .player-wrapper iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; }
        
        .player-nav { display: flex; justify-content: space-between; margin-top: 15px; gap: 10px; }
        .nav-btn { flex: 1; background: #161922; border: 1px solid var(--border-color); color: #cbd5e1; padding: 10px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; text-align: center; transition: background 0.2s; }
        .nav-btn:hover:not(:disabled) { background: var(--primary); border-color: var(--primary); color: #fff; }
        .nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .fallback-action { text-align: center; margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--border-color); }
    </style>
</head>
<body>
    <header>
        <div class="logo-area" onclick="backToHome()">
            <h1>ANIMEX</h1>
        </div>
        <div class="search-box">
            <input type="text" id="searchInput" placeholder="Cari anime..." onkeypress="if(event.key === 'Enter') searchAnime()">
            <button class="search-btn" onclick="searchAnime()">Cari</button>
        </div>
    </header>

    <div class="container">
        <div id="home-section">
            <div class="section-title">Rilis Terbaru & Populer</div>
            <div class="grid" id="resultContainer"><p style="color:var(--text-muted)">Memuat anime...</p></div>
        </div>

        <div id="detail-section">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <button class="back-btn" onclick="backToHome()">← Kembali</button>
            </div>

            <div id="latestEpisodeBanner" style="display: none;" class="latest-ep-box">
                <span id="latestEpText">🔥 Episode Terbaru Tersedia!</span>
                <button class="watch-latest-btn" id="watchLatestBtn">Tonton Sekarang 🚀</button>
            </div>

            <div class="detail-header">
                <img id="detail-thumb" src="" alt="Poster">
                <div class="detail-info">
                    <h2 id="detail-title"></h2>
                    <div class="badges-row">
                        <span class="badge badge-score" id="detail-score">⭐ -</span>
                        <span class="badge" id="detail-year">📅 -</span>
                    </div>
                    <div class="genre-tags" id="detail-genres"></div>
                    <div class="synopsis-box" id="detail-synopsis">Memuat sinopsis...</div>
                </div>
            </div>
            
            <div class="section-title" style="margin-top: 25px; margin-bottom: 10px;">Daftar Episode Lengkap</div>
            <div class="ep-grid" id="episodeContainer"></div>
        </div>

        <div id="player-section">
            <button class="back-btn" onclick="backToDetail()">← Kembali ke Detail</button>
            <h2 id="player-title" style="font-size: 16px; margin-top: 0; margin-bottom: 15px; color: #cbd5e1;"></h2>
            
            <div class="player-wrapper" id="video-container"></div>
            
            <div class="player-nav">
                <button class="nav-btn" id="prevBtn" onclick="changeEpisode(1)">← Episode Sebelumnya</button>
                <button class="nav-btn" id="nextBtn" onclick="changeEpisode(-1)">Episode Selanjutnya →</button>
            </div>

            <div id="fallback-container" class="fallback-action" style="display: none;"></div>
        </div>
    </div>

    <script>
        window.onload = () => searchAnime();
        let allEpisodes = [];
        let currentIndex = 0;

        async function searchAnime() {
            const q = document.getElementById('searchInput').value;
            const container = document.getElementById('resultContainer');
            container.innerHTML = "<p style='color:var(--text-muted)'>Mencari...</p>";
            
            try {
                const res = await fetch('/api/search?q=' + encodeURIComponent(q));
                const data = await res.json();
                
                let list = [];
                if (data.Result) {
                    if (Array.isArray(data.Result)) list = data.Result;
                    else if (data.Result.latest_releases) list = data.Result.latest_releases;
                    else if (data.Result.data) list = data.Result.data;
                }

                container.innerHTML = '';
                if (list.length === 0) {
                    container.innerHTML = '<p style="color:var(--text-muted)">Anime tidak ditemukan.</p>';
                    return;
                }

                list.forEach(a => {
                    const epText = a.episode || a.current_episode || a.latest_episode || (a.episodes ? 'Ep ' + a.episodes : '');
                    const targetAnimeUrl = a.anime_url || a.url;
                    const directEpUrl = a.is_episode ? a.url : '';
                    const directEpTitle = a.headline || a.title;
                    
                    const card = document.createElement('div');
                    card.className = 'card';
                    card.onclick = () => loadDetail(targetAnimeUrl, a.thumbnail, directEpUrl, directEpTitle);
                    card.innerHTML = \`
                        <div class="card-img-wrapper">
                            <img src="\${a.thumbnail || ''}" onerror="this.src='https://via.placeholder.com/170x240?text=No+Image'">
                            \${epText ? \`<div class="ep-badge">\${epText}</div>\` : ''}
                        </div>
                        <div class="card-content">
                            <p>\${a.title || 'Tanpa Judul'}</p>
                        </div>
                    \`;
                    container.appendChild(card);
                });
            } catch (err) {
                container.innerHTML = '<p style="color:red;">Gagal memuat data.</p>';
            }
        }

        async function loadDetail(url, fallbackThumb, directEpUrl, directEpTitle) {
            document.getElementById('home-section').style.display = 'none';
            document.getElementById('detail-section').style.display = 'block';
            document.getElementById('detail-title').innerText = "Memuat detail...";
            document.getElementById('detail-score').innerText = "⭐ -";
            document.getElementById('detail-year').innerText = "📅 -";
            document.getElementById('detail-genres').innerHTML = "";
            document.getElementById('detail-synopsis').innerText = "Memuat sinopsis terjemahan...";
            document.getElementById('episodeContainer').innerHTML = "<p style='color:var(--text-muted)'>Memuat episode...</p>";
            
            const banner = document.getElementById('latestEpisodeBanner');
            banner.style.display = 'none';
            window.scrollTo({ top: 0, behavior: 'smooth' });

            if (directEpUrl) {
                document.getElementById('latestEpText').innerText = \`🔥 Tersedia: \${directEpTitle || 'Episode Terbaru'}\`;
                document.getElementById('watchLatestBtn').onclick = () => playCustomEpisode(directEpUrl, directEpTitle || 'Episode Terbaru');
                banner.style.display = 'flex';
            }

            try {
                const res = await fetch('/api/detail?url=' + encodeURIComponent(url));
                const data = await res.json();
                const d = data.Result || data;

                document.getElementById('detail-title').innerText = d.title || "Detail Anime";
                document.getElementById('detail-thumb').src = d.thumbnail || fallbackThumb || '';
                document.getElementById('detail-score').innerText = \`⭐ \${d.score || '-'}\`;
                document.getElementById('detail-year').innerText = \`📅 \${d.year || '-'}\`;
                document.getElementById('detail-synopsis').innerText = d.synopsis || "Sinopsis tidak tersedia.";

                const genreCont = document.getElementById('detail-genres');
                genreCont.innerHTML = '';
                if (d.genres && d.genres.length > 0) {
                    d.genres.forEach(g => {
                        const tag = document.createElement('span');
                        tag.className = 'genre-tag';
                        tag.innerText = g;
                        genreCont.appendChild(tag);
                    });
                }

                const epCont = document.getElementById('episodeContainer');
                epCont.innerHTML = '';
                
                allEpisodes = d.episode_list || d.episode_lists || [];
                if (allEpisodes.length === 0) {
                    epCont.innerHTML = '<p style="color:var(--text-muted)">Episode tidak tersedia di list utama.</p>';
                    return;
                }

                allEpisodes.forEach((ep, index) => {
                    const btn = document.createElement('button');
                    btn.className = 'ep-btn';
                    btn.innerText = ep.title || ('Episode');
                    btn.onclick = () => playEpisode(index);
                    epCont.appendChild(btn);
                });
            } catch (e) {
                document.getElementById('episodeContainer').innerHTML = '<p style="color:red;">Gagal memuat detail.</p>';
            }
        }

        async function playCustomEpisode(url, title) {
            document.getElementById('detail-section').style.display = 'none';
            document.getElementById('player-section').style.display = 'block';
            document.getElementById('player-title').innerText = title;
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            const container = document.getElementById('video-container');
            const fallback = document.getElementById('fallback-container');
            document.getElementById('prevBtn').disabled = true;
            document.getElementById('nextBtn').disabled = true;

            container.innerHTML = '<p style="text-align:center; position:absolute; top:40%; left:0; right:0; color:var(--text-muted);">Mendeteksi server video...</p>';
            fallback.style.display = 'none';
            fallback.innerHTML = '';

            try {
                const res = await fetch('/api/get-video?url=' + encodeURIComponent(url));
                const data = await res.json();
                
                if (data.success && data.url) {
                    container.innerHTML = \`<iframe src="\${data.url}" allowfullscreen></iframe>\`;
                    fallback.style.display = 'block';
                    fallback.innerHTML = \`
                        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 10px;">Video tidak muncul atau layar hitam?</p>
                        <a href="\${url}" target="_blank" style="display: inline-block; background: var(--primary); color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: bold;">
                            Tonton di Sumber Asli ↗
                        </a>
                    \`;
                } else {
                    container.innerHTML = '<p style="text-align:center; position:absolute; top:40%; left:0; right:0; color:yellow;">Gagal menemukan link pemutar.</p>';
                    fallback.style.display = 'block';
                    fallback.innerHTML = \`<a href="\${url}" target="_blank" style="display: inline-block; background: var(--primary); color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: bold;">Buka Halaman Aslinya ↗</a>\`;
                }
            } catch (err) {
                container.innerHTML = '<p style="text-align:center; position:absolute; top:40%; left:0; right:0; color:red;">Terjadi kesalahan saat memuat video.</p>';
            }
        }

        async function playEpisode(index) {
            currentIndex = index;
            const ep = allEpisodes[currentIndex];
            
            document.getElementById('detail-section').style.display = 'none';
            document.getElementById('player-section').style.display = 'block';
            document.getElementById('player-title').innerText = ep.title || 'Streaming Episode';
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            const container = document.getElementById('video-container');
            const fallback = document.getElementById('fallback-container');
            const prevBtn = document.getElementById('prevBtn');
            const nextBtn = document.getElementById('nextBtn');

            prevBtn.disabled = currentIndex >= allEpisodes.length - 1;
            nextBtn.disabled = currentIndex <= 0;
            
            container.innerHTML = '<p style="text-align:center; position:absolute; top:40%; left:0; right:0; color:var(--text-muted);">Mendeteksi server video...</p>';
            fallback.style.display = 'none';
            fallback.innerHTML = '';

            try {
                const res = await fetch('/api/get-video?url=' + encodeURIComponent(ep.url));
                const data = await res.json();
                
                if (data.success && data.url) {
                    container.innerHTML = \`<iframe src="\${data.url}" allowfullscreen></iframe>\`;
                    fallback.style.display = 'block';
                    fallback.innerHTML = \`
                        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 10px;">Video tidak muncul atau layar hitam?</p>
                        <a href="\${ep.url}" target="_blank" style="display: inline-block; background: var(--primary); color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: bold;">
                            Tonton di Sumber Asli ↗
                        </a>
                    \`;
                } else {
                    container.innerHTML = '<p style="text-align:center; position:absolute; top:40%; left:0; right:0; color:yellow;">Gagal menemukan link pemutar.</p>';
                    fallback.style.display = 'block';
                    fallback.innerHTML = \`<a href="\${ep.url}" target="_blank" style="display: inline-block; background: var(--primary); color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: bold;">Buka Halaman Aslinya ↗</a>\`;
                }
            } catch (err) {
                container.innerHTML = '<p style="text-align:center; position:absolute; top:40%; left:0; right:0; color:red;">Terjadi kesalahan saat memuat video.</p>';
            }
        }

        function changeEpisode(direction) {
            const newIndex = currentIndex + direction;
            if (newIndex >= 0 && newIndex < allEpisodes.length) {
                playEpisode(newIndex);
            }
        }

        function backToHome() {
            document.getElementById('home-section').style.display = 'block';
            document.getElementById('detail-section').style.display = 'none';
            document.getElementById('player-section').style.display = 'none';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function backToDetail() {
            document.getElementById('detail-section').style.display = 'block';
            document.getElementById('player-section').style.display = 'none';
            document.getElementById('video-container').innerHTML = ''; 
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    </script>
</body>
</html>`);
});

app.listen(PORT, () => {
    console.log(`Server ANIMEX aktif di port ${PORT}`);
});
