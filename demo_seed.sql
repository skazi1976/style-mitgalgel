-- Demo seed — 2 sellers + 12 items with Unsplash photos
-- Safe to re-run: uses INSERT OR IGNORE on users and explicit item ids are auto

INSERT OR IGNORE INTO users (phone, name, city, created_at, last_active, items_listed, items_sold, rating, rating_count)
VALUES
  ('972521111111', 'מיכל לוי',  'תל אביב',  strftime('%s','now')-86400*30, strftime('%s','now'), 0, 5, 5.0, 4),
  ('972532222222', 'דנה כהן',   'רמת גן',    strftime('%s','now')-86400*22, strftime('%s','now'), 0, 3, 4.9, 3);

-- Items reference sellers by phone (more robust than guessing ids)
INSERT INTO items (user_id, title, description, price, brand, size, category, condition, photos, city, status, views, favorites_count, created_at)
VALUES
  ((SELECT id FROM users WHERE phone='972506818716'),
   'שמלת ערב שחורה אלגנטית',
   'שמלה מרשימה למחיר מציאה. נלבשה פעם אחת בחתונה. ללא כתמים, במצב כמו חדש.',
   180, 'Zara', 'M', 'dress', 'like_new',
   '["https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800&q=80","https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=800&q=80"]',
   'תל אביב', 'active', 42, 5, strftime('%s','now')-3600*6),

  ((SELECT id FROM users WHERE phone='972506818716'),
   'ג׳ינס מאמא ונטג׳ מותני גבוהות',
   'ג׳ינס תכלת עם גזרה נוחה, בד קשיח איכותי. מושלם ליומיום.',
   95, 'Levi''s', '27', 'jeans', 'good',
   '["https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=800&q=80"]',
   'תל אביב', 'active', 31, 3, strftime('%s','now')-3600*18),

  ((SELECT id FROM users WHERE phone='972506818716'),
   'נעלי עקב אדומות',
   'נעלי עקב עור בצבע אדום מרהיב. נלבשו פעמיים בלבד. מידה 38.',
   150, 'Steve Madden', '38', 'shoes', 'like_new',
   '["https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=800&q=80"]',
   'תל אביב', 'active', 67, 12, strftime('%s','now')-3600*30),

  ((SELECT id FROM users WHERE phone='972506818716'),
   'תיק יד קרם',
   'תיק עור עדין בצבע ניוד, מתאים לכל שמלה. מצב מצוין.',
   120, 'Mango', null, 'bag', 'like_new',
   '["https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800&q=80"]',
   'תל אביב', 'active', 28, 7, strftime('%s','now')-3600*50),

  ((SELECT id FROM users WHERE phone='972521111111'),
   'חולצת קרופ לבנה',
   'חולצת קיץ קצרה, בד רך ונושם. מידה S-M.',
   45, 'H&M', 'S', 'shirt', 'new',
   '["https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80"]',
   'תל אביב', 'active', 19, 2, strftime('%s','now')-3600*3),

  ((SELECT id FROM users WHERE phone='972521111111'),
   'שמלת פרחים בוהו',
   'שמלת מקסי עם הדפס פרחים עדין. מעולה לחוף ולערבי קיץ.',
   135, 'Zara', 'M', 'dress', 'like_new',
   '["https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=800&q=80"]',
   'תל אביב', 'active', 54, 9, strftime('%s','now')-3600*12),

  ((SELECT id FROM users WHERE phone='972521111111'),
   'ז׳קט ג׳ינס קלאסי',
   'ז׳קט ג׳ינס כחול כהה, אקססורי חובה לכל ארון.',
   85, 'Levi''s', 'M', 'jacket', 'good',
   '["https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800&q=80"]',
   'תל אביב', 'active', 38, 4, strftime('%s','now')-3600*26),

  ((SELECT id FROM users WHERE phone='972521111111'),
   'חצאית עיפרון שחורה',
   'חצאית מחוייטת אלגנטית לעבודה או אירועים. מידה 38.',
   70, 'Mango', 'M', 'skirt', 'like_new',
   '["https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=800&q=80"]',
   'תל אביב', 'active', 22, 3, strftime('%s','now')-3600*40),

  ((SELECT id FROM users WHERE phone='972532222222'),
   'סניקרס לבנות קלאסיות',
   'נעלי ספורט לבנות במצב מעולה. מידה 39. נוחות במיוחד.',
   110, 'Adidas', '39', 'shoes', 'good',
   '["https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80"]',
   'רמת גן', 'active', 49, 6, strftime('%s','now')-3600*8),

  ((SELECT id FROM users WHERE phone='972532222222'),
   'תיק מוטו שחור',
   'תיק כתף עור שחור עם רוכסנים. מושלם ליום-יום.',
   160, 'Aldo', null, 'bag', 'like_new',
   '["https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=800&q=80"]',
   'רמת גן', 'active', 33, 5, strftime('%s','now')-3600*16),

  ((SELECT id FROM users WHERE phone='972532222222'),
   'מעיל חורף ארוך',
   'מעיל אפור מחומם, מידה M. לבוש פחות מעונה אחת.',
   220, 'Castro', 'M', 'jacket', 'like_new',
   '["https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=800&q=80"]',
   'רמת גן', 'active', 61, 11, strftime('%s','now')-3600*22),

  ((SELECT id FROM users WHERE phone='972532222222'),
   'עגילי זהב מעודנים',
   'עגילים קטנים ביומיומי, ציפוי זהב, לא מחלידים.',
   40, null, null, 'accessories', 'new',
   '["https://images.unsplash.com/photo-1535556116002-6281ff3e9f36?w=800&q=80"]',
   'רמת גן', 'active', 15, 2, strftime('%s','now')-3600*44);

-- Sync items_listed counts
UPDATE users SET items_listed = (SELECT COUNT(*) FROM items WHERE items.user_id = users.id AND items.status = 'active');
