const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// データベースファイルのパス（ローカル）
const dbPath = path.join(__dirname, 'database.sqlite');

// データベースディレクトリが存在しない場合は作成
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// データベース接続（Promiseベースでラップ）
function getDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('データベース接続エラー:', err);
                reject(err);
            } else {
                resolve(db);
            }
        });
    });
}

// 初期化（テーブル作成）
async function initDatabase() {
    const db = await getDb();
    
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    created_at TEXT DEFAULT (datetime('now', 'localtime'))
                )
            `);
            
            db.run(`
                CREATE TABLE IF NOT EXISTS posts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `);
            
            db.run(`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)`);
            
            db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

// ユーザーを取得または作成
async function getOrCreateUser(username) {
    const db = await getDb();
    
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
            if (err) {
                db.close();
                reject(err);
                return;
            }
            
            if (row) {
                db.close();
                resolve(row);
            } else {
                db.run('INSERT INTO users (username) VALUES (?)', [username], function(insertErr) {
                    if (insertErr) {
                        db.close();
                        reject(insertErr);
                        return;
                    }
                    
                    db.get('SELECT * FROM users WHERE id = ?', [this.lastID], (queryErr, newRow) => {
                        db.close();
                        if (queryErr) {
                            reject(queryErr);
                        } else {
                            resolve(newRow);
                        }
                    });
                });
            }
        });
    });
}

// 投稿を追加
async function addPost(username, content) {
    const user = await getOrCreateUser(username);
    const db = await getDb();
    
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO posts (user_id, username, content) VALUES (?, ?, ?)',
            [user.id, username, content],
            function(err) {
                if (err) {
                    db.close();
                    reject(err);
                    return;
                }
                
                db.get('SELECT * FROM posts WHERE id = ?', [this.lastID], (queryErr, row) => {
                    db.close();
                    if (queryErr) {
                        reject(queryErr);
                    } else {
                        resolve(row);
                    }
                });
            }
        );
    });
}

// 最新の投稿を取得（最新1000件）
async function getLatestPosts(limit = 1000) {
    const db = await getDb();
    
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT id, username, content, created_at FROM posts ORDER BY created_at DESC LIMIT ?',
            [limit],
            (err, rows) => {
                db.close();
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// IDより新しい投稿を取得（ポーリング用）
async function getNewPostsSince(lastId) {
    const db = await getDb();
    
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT id, username, content, created_at FROM posts WHERE id > ? ORDER BY created_at DESC',
            [lastId],
            (err, rows) => {
                db.close();
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// 投稿数を取得
async function getPostCount() {
    const db = await getDb();
    
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM posts', (err, row) => {
            db.close();
            if (err) {
                reject(err);
            } else {
                resolve(row.count);
            }
        });
    });
}

// データベース初期化
initDatabase().catch(err => {
    console.error('データベース初期化エラー:', err);
});

module.exports = {
    getOrCreateUser,
    addPost,
    getLatestPosts,
    getNewPostsSince,
    getPostCount,
    getDb
};
