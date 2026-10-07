(() => {
    'use strict';

    const API = 'https://bsaxkggwofrzjroqxezp.supabase.co';
    const PUBLIC_KEY = 'sb_publishable_y_PLu8Q7L-J10H4-wdrJ9g_xi6XnVQF';
    const OWNER_EMAIL = 'fawazgp77@gmail.com';
    const BUCKET = 'campus-gallery';
    const SESSION_KEY = 'vnit-site-admin-session';
    const panel = document.getElementById('gallery-admin');
    if (!panel) return;

    const toggle = document.getElementById('gallery-admin-toggle');
    const login = document.getElementById('gallery-admin-login');

    const dashboard = document.getElementById('gallery-admin-dashboard');
    const loginMessage = document.getElementById('gallery-admin-message');
    const dashboardMessage = document.getElementById('gallery-admin-dashboard-message');
    const tagSelect = document.getElementById('gallery-admin-tag');
    let session = readSession();
    let currentRows = [];
    let currentUser = null;
    let reviews = [];
    let reviewOffset = 0;
    let reviewRestaurant = '';
    let restaurantRequests = [];
    const REVIEW_PAGE_SIZE = 20;

    function readSession() {
        try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
        catch { return null; }
    }

    function saveSession(value) {
        session = value;
        try {
            if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
            else localStorage.removeItem(SESSION_KEY);
        } catch { /* The user can still use the current page session. */ }
    }

    function setMessage(element, value, error = false) {
        element.textContent = value;
        element.dataset.error = String(error);
    }

    async function api(path, options = {}, token = session?.access_token) {
        const headers = { apikey: PUBLIC_KEY, ...(options.headers || {}) };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (options.body && !(options.body instanceof Blob)) headers['Content-Type'] = 'application/json';
        const response = await fetch(`${API}${path}`, { ...options, headers });
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || data?.error || `Request failed (${response.status}).`);
        return data;
    }

    async function auth(path, body, token = null, method = 'POST') {
        return api(path, { method, body: JSON.stringify(body) }, token);
    }

    async function activeToken() {
        if (!session?.access_token) throw new Error('Sign in again to continue.');
        if (session.expires_at && session.expires_at < Date.now() + 60_000 && session.refresh_token) {
            const refreshed = await auth('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token }, null);
            saveSession({ ...refreshed, expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000 });
        }
        return session.access_token;
    }

    async function adminApi(path, options = {}) {
        return api(path, options, await activeToken());
    }

    function isAdmin(user) {
        return user?.app_metadata?.site_admin === true;
    }

    async function hydratePublicGallery() {
        try {
            const rows = await api('/rest/v1/gallery_occasions?select=id,title,event_date,tag,gallery_photos(id,storage_path,source_url,alt_text,label,caption,sort_order)&order=event_date.desc', {}, null);
            if (!Array.isArray(rows)) return;
            window.VNIT_GALLERY_SET_EVENTS?.(toEvents(rows));
        } catch (error) {
            console.warn('Gallery database is not available; showing the saved gallery content.', error);
        }
    }

    function photoUrl(photo) {
        return photo.source_url || `${API}/storage/v1/object/public/${BUCKET}/${(photo.storage_path || '').split('/').map(encodeURIComponent).join('/')}`;
    }

    function toEvents(rows) {
        return rows.map(row => ({
            id: row.id,
            occasion: row.title,
            date: row.event_date,
            tag: row.tag || 'Campus Life',
            photos: (row.gallery_photos || []).sort((a, b) => a.sort_order - b.sort_order).map(photo => ({
                id: photo.id,
                storagePath: photo.storage_path,
                src: photoUrl(photo),
                alt: photo.alt_text || row.title,
                label: photo.label || '',
                caption: photo.caption || '',
            })),
        }));
    }

    function updateMode(user) {
        const allowed = isAdmin(user);
        currentUser = allowed ? user : null;
        login.hidden = allowed;
        dashboard.hidden = !allowed;
        if (allowed) {
            const mustChange = user.app_metadata?.must_change_password === true;
            document.getElementById('gallery-admin-account').textContent = `${user.email}${mustChange ? ' · Change your temporary password to continue' : ''}`;
            document.getElementById('admin-managed-content').hidden = mustChange;
            document.getElementById('admin-add-user').hidden = user.email?.toLowerCase() !== OWNER_EMAIL;
            if (!mustChange) loadDashboard().catch(error => setMessage(dashboardMessage, error.message, true));
        }
    }

    async function checkSavedSession() {
        if (!session?.access_token) return;
        try {
            const user = await adminApi('/auth/v1/user', { method: 'GET' });
            if (isAdmin(user)) updateMode(user);
            else saveSession(null);
        } catch { saveSession(null); }
    }

    async function loadDashboard() {
        setMessage(dashboardMessage, '');
        await adminApi('/functions/v1/site-admin', { method: 'POST', body: JSON.stringify({ action: 'status' }) });
        currentRows = await adminApi('/rest/v1/gallery_occasions?select=id,title,event_date,tag,gallery_photos(id,storage_path,source_url,alt_text,label,caption,sort_order)&order=event_date.desc', { method: 'GET' });
        renderOccasionOptions();
        renderOccasions();
        await Promise.all([loadReviewRestaurants(), loadRestaurantRequests()]);
    }

    function renderOccasionOptions() {
        const previous = tagSelect.value;
        tagSelect.replaceChildren();
        const tags = [...new Set(currentRows.map(row => row.tag).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        tags.forEach(tag => {
            const option = document.createElement('option');
            option.value = tag;
            option.textContent = tag;
            tagSelect.append(option);
        });
        const newOption = document.createElement('option');
        newOption.value = '__new__';
        newOption.textContent = '＋ New filter group…';
        tagSelect.append(newOption);
        if (tags.includes(previous)) tagSelect.value = previous;
        else if (tags.length) tagSelect.value = tags[0];
    }

    function renderOccasions() {
        const list = document.getElementById('gallery-admin-occasion-list');
        list.replaceChildren();
        document.getElementById('gallery-admin-occasion-count').textContent = `${currentRows.length} section${currentRows.length === 1 ? '' : 's'}`;
        for (const row of currentRows) {
            const section = document.createElement('details');
            section.className = 'gallery-admin-occasion';
            section.open = false;
            const summary = document.createElement('summary');
            summary.textContent = `${row.title} · ${row.event_date.slice(0, 4)}`;
            section.append(summary);
            const form = document.createElement('form');
            form.className = 'gallery-admin-form gallery-admin-occasion-row';
            const fields = document.createElement('div');
            fields.className = 'gallery-admin-fields';
            for (const [labelText, name, type, value, max] of [
                ['Heading', 'title', 'text', row.title, 100],
                ['Date', 'event_date', 'month', row.event_date.slice(0, 7), 7],
                ['Filter group', 'tag', 'text', row.tag, 40],
            ]) {
                const label = document.createElement('label');
                label.textContent = labelText;
                const input = name === 'tag' ? document.createElement('select') : document.createElement('input');
                input.name = name; if (name !== 'tag') input.type = type; input.value = value; input.maxLength = max; input.required = true;
                if (name === 'tag') {
                    [...new Set(currentRows.map(item => item.tag).filter(Boolean))].sort().forEach(tag => {
                        const option = document.createElement('option'); option.value = tag; option.textContent = tag; input.append(option);
                    });
                    input.value = value;
                }
                label.append(input);
                fields.append(label);
            }
            const actions = document.createElement('div');
            actions.className = 'gallery-admin-actions';
            const save = document.createElement('button');
            save.className = 'gallery-admin-primary';
            save.type = 'submit';
            save.textContent = 'Save heading';
            const remove = document.createElement('button');
            remove.className = 'gallery-admin-delete';
            remove.type = 'button';
            remove.textContent = 'Delete section';
            remove.addEventListener('click', () => deleteOccasion(row, remove));
            actions.append(save, remove);
            form.append(fields, actions);
            form.addEventListener('submit', async event => {
                event.preventDefault();
                save.disabled = true;
                try {
                    const values = Object.fromEntries(new FormData(form));
                    await adminApi(`/rest/v1/gallery_occasions?id=eq.${encodeURIComponent(row.id)}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ title: values.title.trim(), event_date: values.event_date, tag: values.tag.trim() }),
                    });
                    await refreshGallery();
                    setMessage(dashboardMessage, 'Occasion updated.');
                } catch (error) { setMessage(dashboardMessage, error.message, true); save.disabled = false; }
            });
            section.append(form);
            const photoHeading = document.createElement('h4'); photoHeading.textContent = `Photos (${row.gallery_photos?.length || 0})`;
            const upload = document.createElement('form'); upload.className = 'gallery-admin-photo-upload';
            const files = document.createElement('input'); files.type = 'file'; files.accept = 'image/jpeg,image/png,image/webp'; files.multiple = true; files.required = true;
            const uploadButton = document.createElement('button'); uploadButton.className = 'gallery-admin-primary'; uploadButton.type = 'submit'; uploadButton.textContent = 'Add photos';
            upload.append(files, uploadButton);
            upload.addEventListener('submit', event => uploadPhotosForOccasion(event, row, files, uploadButton));
            section.append(photoHeading, upload);
            const photoList = document.createElement('div'); photoList.className = 'gallery-admin-occasion-photos';
            (row.gallery_photos || []).forEach(photo => photoList.append(makeAdminPhoto(row, photo)));
            if (!row.gallery_photos?.length) { const empty = document.createElement('p'); empty.className = 'gallery-admin-hint'; empty.textContent = 'No photos yet.'; photoList.append(empty); }
            section.append(photoList);
            list.append(section);
        }
    }

    function makeAdminPhoto(row, photo) {
        const entry = document.createElement('div'); entry.className = 'gallery-admin-photo-row';
        const image = document.createElement('img'); image.src = photoUrl(photo); image.alt = photo.alt_text || '';
        const description = document.createElement('p'); description.textContent = photo.label || photo.alt_text || 'Unnamed photo';
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'gallery-admin-delete'; remove.textContent = 'Remove'; remove.addEventListener('click', () => deletePhoto(row, photo, remove));
        const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'gallery-admin-link'; rename.textContent = 'Rename';
        const editor = document.createElement('form'); editor.className = 'gallery-admin-photo-rename'; editor.hidden = true;
        const input = document.createElement('input'); input.name = 'label'; input.type = 'text'; input.maxLength = 100; input.value = photo.label || ''; input.placeholder = 'Leave blank to remove the label';
        const save = document.createElement('button'); save.type = 'submit'; save.className = 'gallery-admin-primary'; save.textContent = 'Save name';
        editor.append(input, save);
        rename.addEventListener('click', () => { editor.hidden = !editor.hidden; if (!editor.hidden) input.focus(); });
        editor.addEventListener('submit', async event => {
            event.preventDefault(); save.disabled = true;
            try {
                await adminApi(`/rest/v1/gallery_photos?id=eq.${encodeURIComponent(photo.id)}`, { method: 'PATCH', body: JSON.stringify({ label: input.value.trim() }) });
                await refreshGallery(); setMessage(dashboardMessage, 'Photo name updated.');
            } catch (error) { save.disabled = false; setMessage(dashboardMessage, error.message, true); }
        });
        const actions = document.createElement('div'); actions.className = 'gallery-admin-photo-actions'; actions.append(rename, remove);
        entry.append(image, description, actions, editor); return entry;
    }

    async function uploadPhotosForOccasion(event, row, filesInput, button) {
        event.preventDefault(); const files = [...filesInput.files]; if (!files.length) return;
        if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) return setMessage(dashboardMessage, 'Choose JPEG, PNG or WebP photos up to 10 MB each.', true);
        button.disabled = true;
        try {
            for (const file of files) {
                const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]; const path = `${row.id}/${crypto.randomUUID()}.${extension}`;
                await adminApi(`/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file });
                const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
                await adminApi('/rest/v1/gallery_photos', { method: 'POST', body: JSON.stringify({ occasion_id: row.id, storage_path: path, alt_text: alt || 'Campus photo', label: alt || 'Campus photo' }) });
            }
            await refreshGallery(); setMessage(dashboardMessage, `${files.length} photo${files.length === 1 ? '' : 's'} added.`);
        } catch (error) { setMessage(dashboardMessage, error.message, true); }
        finally { button.disabled = false; }
    }

    async function deleteOccasion(row, button) {
        if (!window.confirm(`Delete “${row.title}” and its ${row.gallery_photos?.length || 0} photos? This cannot be undone.`)) return;
        button.disabled = true;
        try {
            const paths = (row.gallery_photos || []).map(photo => photo.storage_path).filter(Boolean);
            await adminApi(`/rest/v1/gallery_occasions?id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE' });
            let cleanupFailed = false;
            if (paths.length) await adminApi(`/storage/v1/object/${BUCKET}`, {
                method: 'DELETE', body: JSON.stringify({ prefixes: paths }),
            }).catch(() => { cleanupFailed = true; });
            await refreshGallery();
            setMessage(dashboardMessage, cleanupFailed ? 'Occasion deleted, but some stored files could not be cleaned up.' : 'Occasion deleted.', cleanupFailed);
        } catch (error) { button.disabled = false; setMessage(dashboardMessage, error.message, true); }
    }

    async function loadReviewRestaurants() {
        const select = document.getElementById('admin-review-restaurant');
        const rows = await adminApi('/rest/v1/guide_restaurants?select=id,name&order=name.asc');
        select.replaceChildren();
        const all = document.createElement('option');
        all.value = '';
        all.textContent = 'All restaurants';
        select.append(all);
        rows.forEach(row => {
            const option = document.createElement('option');
            option.value = row.id;
            option.textContent = row.name;
            select.append(option);
        });
        select.value = reviewRestaurant;
        await loadAdminReviews(true);
    }

    async function loadAdminReviews(reset = false) {
        const list = document.getElementById('admin-review-list');
        const more = document.getElementById('admin-review-more');
        if (reset) { reviews = []; reviewOffset = 0; list.textContent = 'Loading reviews…'; }
        more.disabled = true;
        try {
            const filter = reviewRestaurant ? `&restaurant_id=eq.${encodeURIComponent(reviewRestaurant)}` : '';
            const rows = await adminApi(`/rest/v1/restaurant_reviews?select=id,restaurant_id,author_name,rating,body,created_at&order=created_at.desc&limit=${REVIEW_PAGE_SIZE}&offset=${reviewOffset}${filter}`);
            if (reset) list.replaceChildren();
            reviews.push(...rows);
            reviewOffset += rows.length;
            renderAdminReviews();
            more.hidden = rows.length < REVIEW_PAGE_SIZE;
        } catch (error) { setMessage(dashboardMessage, error.message, true); }
        finally { more.disabled = false; }
    }

    async function loadRestaurantRequests() {
        const list = document.getElementById('admin-request-list');
        list.textContent = 'Loading suggestions…';
        try {
            restaurantRequests = await adminApi('/rest/v1/restaurant_requests?select=id,restaurant_name,listing_url,location,restaurant_type,created_at,notification_status&order=created_at.desc&limit=100');
            if (!Array.isArray(restaurantRequests)) restaurantRequests = [];
            renderRestaurantRequests();
        } catch (error) {
            list.replaceChildren();
            const message = document.createElement('p');
            message.className = 'gallery-admin-hint';
            message.textContent = error.message;
            list.append(message);
        }
    }

    function renderRestaurantRequests() {
        const list = document.getElementById('admin-request-list');
        list.replaceChildren();
        if (!restaurantRequests.length) {
            const empty = document.createElement('p');
            empty.className = 'gallery-admin-hint';
            empty.textContent = 'No restaurant suggestions yet.';
            list.append(empty);
            return;
        }
        for (const row of restaurantRequests) {
            const entry = document.createElement('article');
            entry.className = 'gallery-admin-request-row';
            const details = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = row.restaurant_name;
            const meta = document.createElement('small');
            meta.textContent = `${row.restaurant_type} · ${new Date(row.created_at).toLocaleDateString('en-IN')}`;
            const location = document.createElement('p');
            location.textContent = row.location;
            details.append(title, meta, location);
            if (row.listing_url) {
                const listing = document.createElement('a');
                listing.className = 'gallery-admin-request-link';
                listing.href = row.listing_url;
                listing.target = '_blank';
                listing.rel = 'noopener noreferrer';
                listing.textContent = 'Open listing';
                details.append(listing);
            }
            const status = document.createElement('span');
            status.className = 'gallery-admin-request-status';
            status.textContent = row.notification_status === 'sent' ? 'Email sent' : 'Pending email';
            entry.append(details, status);
            list.append(entry);
        }
    }

    function renderAdminReviews() {
        const list = document.getElementById('admin-review-list');
        const query = document.getElementById('admin-review-search').value.trim().toLowerCase();
        const restaurants = document.getElementById('admin-review-restaurant');
        const names = new Map([...restaurants.options].map(option => [option.value, option.textContent]));
        list.replaceChildren();
        const shown = reviews.filter(row => !query || `${row.author_name} ${row.body} ${names.get(row.restaurant_id) || ''}`.toLowerCase().includes(query));
        if (!shown.length) {
            const empty = document.createElement('p');
            empty.className = 'gallery-admin-hint';
            empty.textContent = query ? 'No loaded reviews match your search.' : 'No reviews found.';
            list.append(empty);
            return;
        }
        for (const row of shown) {
            const entry = document.createElement('article');
            entry.className = 'gallery-admin-review-row';
            const details = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = `${names.get(row.restaurant_id) || row.restaurant_id} · ${row.rating}/5`;
            const byline = document.createElement('small');
            byline.textContent = `${row.author_name} · ${new Date(row.created_at).toLocaleDateString('en-IN')}`;
            const body = document.createElement('p');
            body.textContent = row.body || '(Stars only)';
            details.append(title, byline, body);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'gallery-admin-delete';
            remove.textContent = 'Remove';
            remove.addEventListener('click', async () => {
                if (!window.confirm(`Remove ${row.author_name}’s review of ${names.get(row.restaurant_id) || row.restaurant_id}?`)) return;
                remove.disabled = true;
                try {
                    await adminApi('/functions/v1/site-admin', { method: 'POST', body: JSON.stringify({ action: 'remove_review', review_id: row.id }) });
                    reviews = reviews.filter(item => item.id !== row.id);
                    renderAdminReviews();
                    setMessage(dashboardMessage, 'Review removed. Its restaurant rating will update from the remaining reviews.');
                    window.dispatchEvent(new Event('vnit-feedback-refresh'));
                } catch (error) { remove.disabled = false; setMessage(dashboardMessage, error.message, true); }
            });
            entry.append(details, remove);
            list.append(entry);
        }
    }

    document.getElementById('admin-review-restaurant').addEventListener('change', event => {
        reviewRestaurant = event.target.value;
        loadAdminReviews(true);
    });
    document.getElementById('admin-review-search').addEventListener('input', renderAdminReviews);
    document.getElementById('admin-review-more').addEventListener('click', () => loadAdminReviews());

    async function refreshGallery() {
        const rows = await adminApi('/rest/v1/gallery_occasions?select=id,title,event_date,tag,gallery_photos(id,storage_path,source_url,alt_text,label,caption,sort_order)&order=event_date.desc', { method: 'GET' });
        currentRows = rows;
        window.VNIT_GALLERY_SET_EVENTS?.(toEvents(rows));
        renderOccasionOptions();
        renderOccasions();
    }

    async function deletePhoto(row, photo, button) {
        if (!window.confirm(`Delete this photo from “${row.title}”? This cannot be undone.`)) return;
        button.disabled = true;
        try {
            await adminApi(`/rest/v1/gallery_photos?id=eq.${encodeURIComponent(photo.id)}`, { method: 'DELETE' });
            let cleanupFailed = false;
            if (photo.storage_path) {
                await adminApi(`/storage/v1/object/${BUCKET}`, {
                    method: 'DELETE',
                    body: JSON.stringify({ prefixes: [photo.storage_path] }),
                }).catch(() => { cleanupFailed = true; });
            }
            await refreshGallery();
            setMessage(dashboardMessage, cleanupFailed ? 'Photo removed, but its stored file could not be cleaned up.' : 'Photo deleted.', cleanupFailed);
        } catch (error) {
            button.disabled = false;
            setMessage(dashboardMessage, error.message, true);
        }
    }

    toggle.addEventListener('click', () => {
        const open = panel.hidden;
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        if (open) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    panel.querySelector('.gallery-admin-close').addEventListener('click', () => {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
    });

    login.addEventListener('submit', async event => {
        event.preventDefault();
        setMessage(loginMessage, 'Signing in…');
        try {
            const result = await auth('/auth/v1/token?grant_type=password', {
                email: document.getElementById('gallery-admin-email').value.trim(),
                password: document.getElementById('gallery-admin-password').value,
            });
            if (!isAdmin(result.user)) throw new Error('This account does not have admin access.');
            saveSession({ ...result, expires_at: Date.now() + Number(result.expires_in || 3600) * 1000 });
            document.getElementById('gallery-admin-password').value = '';
            updateMode(result.user);
        } catch (error) {
            saveSession(null);
            setMessage(loginMessage, error.message, true);
        }
    });

    document.getElementById('admin-change-password').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const password = form.elements.password.value;
        if (password !== form.elements.confirm.value) return setMessage(dashboardMessage, 'Passwords do not match.', true);
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            await adminApi('/functions/v1/site-admin', {
                method: 'POST', body: JSON.stringify({ action: 'change_password', password }),
            });
            const renewed = await auth('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token }, null);
            saveSession({ ...renewed, expires_at: Date.now() + Number(renewed.expires_in || 3600) * 1000 });
            form.reset();
            updateMode(renewed.user);
            setMessage(dashboardMessage, 'Password updated.');
        } catch (error) { setMessage(dashboardMessage, error.message, true); }
        finally { button.disabled = false; }
    });

    document.getElementById('gallery-admin-signout').addEventListener('click', async () => {
        try { await adminApi('/auth/v1/logout', { method: 'POST' }); } catch { /* Expired sessions are cleared locally too. */ }
        saveSession(null);
        currentUser = null;
        dashboard.hidden = true;
        login.hidden = false;
        setMessage(loginMessage, 'Signed out.');
    });

    document.getElementById('admin-add-user').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        const email = form.elements.email.value.trim().toLowerCase();
        const password = form.elements.password.value;
        button.disabled = true;
        try {
            await adminApi('/functions/v1/site-admin', {
                method: 'POST', body: JSON.stringify({ action: 'add_admin', email, password }),
            });
            form.reset();
            setMessage(dashboardMessage, `Admin added: ${email}. Share the temporary password privately.`);
        } catch (error) { setMessage(dashboardMessage, error.message, true); }
        finally { button.disabled = false; }
    });

    document.getElementById('gallery-add-occasion').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const values = Object.fromEntries(new FormData(form));
            const tag = values.tag === '__new__' ? values.new_tag.trim() : values.tag;
            if (!tag) throw new Error('Choose or add a filter group first.');
            await adminApi('/rest/v1/gallery_occasions', {
                method: 'POST',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({ title: values.title.trim(), event_date: values.event_date, tag }),
            });
            form.reset();
            await refreshGallery();
            setMessage(dashboardMessage, 'Occasion added. You can upload photos to it below.');
        } catch (error) { setMessage(dashboardMessage, error.message, true); }
        finally { button.disabled = false; }
    });

    tagSelect.addEventListener('change', () => {
        document.getElementById('gallery-admin-new-group').hidden = tagSelect.value !== '__new__';
        if (tagSelect.value !== '__new__') document.getElementById('gallery-admin-new-tag').value = '';
    });
    document.getElementById('gallery-admin-save-group').addEventListener('click', () => {
        const input = document.getElementById('gallery-admin-new-tag');
        const value = input.value.trim();
        if (!value) return setMessage(dashboardMessage, 'Enter a filter group name.', true);
        const exists = [...tagSelect.options].some(option => option.value === value);
        if (!exists) { const option = document.createElement('option'); option.value = value; option.textContent = value; tagSelect.insertBefore(option, tagSelect.lastElementChild); }
        tagSelect.value = value; document.getElementById('gallery-admin-new-group').hidden = true; input.value = '';
    });

    checkSavedSession();
    hydratePublicGallery();
})();
