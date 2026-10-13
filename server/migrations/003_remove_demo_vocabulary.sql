delete from user_vocabulary_items item
using user_content_seeds seed
where item.user_id = seed.user_id
  and seed.content_type = 'mall-vocabulary'
  and seed.version < 2
  and item.word_id = any(array['shopping-mall', 'cashier', 'escalator', 'fitting-room', 'receipt']::text[]);

update user_content_seeds
set version = 2
where content_type = 'mall-vocabulary' and version < 2;
