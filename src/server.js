const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const { getOrCreateUser, addPost, getLatestPosts, getNewPostsSince } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ミドルウェア
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// 静的ファイルを配信
app.use(express.static(path.join(__dirname)));

// ログインAPI
app.post('/api/login', async (req, res) => {
    try {
        const { username } = req.body;
        
        if (!username || username.trim() === '') {
            return res.status(400).json({ error: 'ユーザー名が必要です' });
        }
        
        const user = await getOrCreateUser(username.trim());
        res.cookie('username', user.username, { 
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30日
            httpOnly: true 
        });
        
        res.json({ success: true, user: { id: user.id, username: user.username } });
    } catch (error) {
        console.error('ログインエラー:', error);
        res.status(500).json({ error: 'ログインに失敗しました' });
    }
});

// ログイン状態確認API
app.get('/api/auth/check', (req, res) => {
    const username = req.cookies.username;
    
    if (username) {
        return res.json({ authenticated: true, username });
    } else {
        return res.json({ authenticated: false });
    }
});

// タイムライン取得API
app.get('/api/timeline', async (req, res) => {
    try {
        const posts = await getLatestPosts();
        res.json({ posts, count: posts.length });
    } catch (error) {
        console.error('タイムライン取得エラー:', error);
        res.status(500).json({ error: 'タイムラインの取得に失敗しました' });
    }
});

// 新しい投稿取得API（ポーリング用）
app.get('/api/timeline/new', async (req, res) => {
    try {
        const lastId = parseInt(req.query.lastId) || 0;
        const posts = await getNewPostsSince(lastId);
        res.json({ posts, count: posts.length });
    } catch (error) {
        console.error('新規投稿取得エラー:', error);
        res.status(500).json({ error: '新規投稿の取得に失敗しました' });
    }
});

// 投稿作成API
app.post('/api/posts', async (req, res) => {
    try {
        const username = req.cookies.username;
        
        if (!username) {
            return res.status(401).json({ error: 'ログインが必要です' });
        }
        
        const { content } = req.body;
        
        if (!content || content.trim() === '') {
            return res.status(400).json({ error: '投稿内容が必要です' });
        }
        
        if (content.length > 50) {
            return res.status(400).json({ error: '投稿は50文字以内にしてください' });
        }
        
        const post = await addPost(username, content.trim());
        res.json({ success: true, post });
    } catch (error) {
        console.error('投稿作成エラー:', error);
        res.status(500).json({ error: '投稿の作成に失敗しました' });
    }
});

// ログアウトAPI
app.post('/api/logout', (req, res) => {
    res.clearCookie('username');
    res.json({ success: true });
});

// ルート（index.htmlを返す）
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// サーバー起動
app.listen(PORT, '0.0.0.0', () => {
    console.log(`サーバーを起動しました`);
    console.log(`\nローカルアクセス:`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`\nチームメンバーは以下のURLにアクセスしてください:`);
    console.log(`  http://192.168.212.132:${PORT}`);
    console.log(`\nサーバーを停止するには Ctrl+C を押してください`);
});
