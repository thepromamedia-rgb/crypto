# Upcoming Games Catalogue Update

- Added panel-scoped upcoming game catalogue management under Admin → Games → Soon Games.
- Admins can add unlimited game entries with a name, description, and JPG/PNG/WEBP image (maximum 5 MB).
- Image preview, replace, and remove controls are available before saving. The form recommends 1200 × 675 px / 16:9.
- Server validates image MIME declaration, encoded data, file signature, and decoded size. The catalogue is stored with the existing panel settings and database persistence layer.
- Newly added games appear automatically on Home and Games with a disabled Soon button. Deleting a game removes it from both sections on the next page render.
- Existing game entries and gameplay code remain unchanged.

Run `npm test` to execute the existing regression suite plus the new catalogue add/list/delete API test.
