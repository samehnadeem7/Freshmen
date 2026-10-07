(() => {
    'use strict';
    const API = 'https://bsaxkggwofrzjroqxezp.supabase.co';
    const PUBLIC_KEY = 'sb_publishable_y_PLu8Q7L-J10H4-wdrJ9g_xi6XnVQF';
    // Public anon JWT is required by the Edge Function gateway. This is not a secret/admin key.
    const ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYXhrZ2d3b2Zyempyb3F4ZXpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1ODI2NTksImV4cCI6MjEwNjE1ODY1OX0.Gr87K0spbLkWhYH0Fxl0mlUY2D2GhfOsFq2GHQtH9Qc';
    const PHOTO_BASE = `${API}/storage/v1/object/public/restaurant-review-photos/`;
    const summaries = new Map();
    const buttons = new Map();
    const PAGE_SIZE = 10;
    let current = null;
    let photos = [];
    let busy = false;
    let preparing = false;
    let generation = 0;
    let cursor = null;
    let requestId = null;
    let ownReviewId = null;

    const dialog = document.createElement('dialog');
    dialog.className = 'feedback-dialog';
    dialog.setAttribute('aria-labelledby', 'feedback-title');
    // Static markup only. All guest content is inserted using textContent.
    dialog.innerHTML = `
        <div class="feedback-heading">
            <div><p class="feedback-muted">FROM THE COMMUNITY</p><h2 id="feedback-title"></h2></div>
            <button type="button" class="feedback-close" aria-label="Close reviews">×</button>
        </div>
        <p class="feedback-summary" id="feedback-summary"></p>
        <form class="feedback-form">
            <h3>Share your experience</h3>
            <fieldset id="feedback-fields">
                <legend>Your rating</legend>
                <div class="feedback-stars">
                    ${[1, 2, 3, 4, 5].map(n => `<label><input type="radio" name="rating" value="${n}" required aria-label="${n} ${n === 1 ? 'star' : 'stars'}"><span aria-hidden="true">★</span></label>`).join('')}
                </div>
                <label for="feedback-name">Name <span class="feedback-muted">(optional)</span></label>
                <input class="feedback-input" id="feedback-name" maxlength="60" placeholder="Guest" autocomplete="nickname">
                <label for="feedback-body">Your review <span class="feedback-muted">(optional)</span></label>
                <textarea class="feedback-input" id="feedback-body" maxlength="2000" placeholder="What did you try? What would you recommend?"></textarea>
                <div class="feedback-upload" tabindex="0" aria-label="Photo area. Paste pictures here, or choose files below.">
                    <label for="feedback-files">Add photos or paste a picture here</label>
                    <p class="feedback-muted">Up to 3 photos · JPG, PNG or WebP · 5 MB each</p>
                    <input id="feedback-files" type="file" accept="image/jpeg,image/png,image/webp" multiple>
                    <div class="feedback-photos" id="feedback-previews"></div>
                </div>
                <p class="feedback-muted">Reviews and photos are public. One review per restaurant from this browser.</p>
                <button type="submit" class="feedback-submit">Post review</button>
            </fieldset>
            <p class="feedback-status" role="status" aria-live="polite" id="feedback-status"></p>
        </form>
        <section class="feedback-reviews" aria-label="Community reviews">
            <h3>Community reviews</h3>
            <div id="feedback-list"></div>
            <button type="button" class="feedback-more" hidden>Show more reviews</button>
        </section>`;
    document.body.appendChild(dialog);
    const $ = selector => dialog.querySelector(selector);
    const form = $('.feedback-form');
    const fields = $('#feedback-fields');
    const status = $('#feedback-status');
    const list = $('#feedback-list');
    const more = $('.feedback-reviews .feedback-more');

    async function api(path, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        try {
            const response = await fetch(API + path, {
                ...options, signal: controller.signal,
                headers: { apikey: PUBLIC_KEY, ...options.headers },
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Could not load reviews. Please try again.');
            return data;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('The connection timed out. Please try again.');
            if (error instanceof TypeError) throw new Error('Could not connect. Check your connection and try again.');
            throw error;
        } finally { clearTimeout(timeout); }
    }

    function summaryText(id) {
        const summary = summaries.get(id);
        if (!summary) return 'Ratings unavailable · View reviews';
        if (!summary.review_count) return '☆ No reviews yet · Be the first';
        return `★ ${Number(summary.average_rating).toFixed(1)} / 5 · ${summary.review_count} ${summary.review_count === 1 ? 'review' : 'reviews'}`;
    }

    async function refreshSummaries() {
        try {
            const data = await api('/rest/v1/restaurant_rating_summary?select=restaurant_id,average_rating,review_count');
            data.forEach(item => summaries.set(item.restaurant_id, item));
        } catch { /* Keep last known ratings; initial failure remains explicit. */ }
        buttons.forEach((items, id) => items.forEach(button => {
            button.textContent = summaryText(id);
        }));
        if (current) $('#feedback-summary').textContent = summaryText(current.id);
    }
    window.addEventListener('vnit-feedback-refresh', () => {
        refreshSummaries();
        if (dialog.open && current) loadReviews(true);
    });

    document.querySelectorAll('.restaurant-link[data-restaurant-id]').forEach(link => {
        const id = link.dataset.restaurantId;
        const name = link.textContent.trim();
        const wrapper = document.createElement('div');
        wrapper.className = 'restaurant-info';
        link.before(wrapper);
        wrapper.appendChild(link);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'restaurant-rating';
        button.textContent = 'Loading ratings…';
        button.setAttribute('aria-label', `Ratings and reviews for ${name}`);
        button.setAttribute('aria-haspopup', 'dialog');
        button.addEventListener('click', () => openReviews(id, name, button));
        wrapper.appendChild(button);
        if (!buttons.has(id)) buttons.set(id, []);
        buttons.get(id).push(button);
    });

    function message(text, error = false) {
        status.textContent = text;
        status.dataset.error = String(error);
    }

    function clearPhotos() {
        photos.forEach(photo => URL.revokeObjectURL(photo.url));
        photos = [];
        $('#feedback-previews').replaceChildren();
    }

    function renderPreviews() {
        const previews = $('#feedback-previews');
        previews.replaceChildren();
        photos.forEach((photo, index) => {
            const item = document.createElement('div');
            item.className = 'feedback-photo';
            const img = document.createElement('img');
            img.src = photo.url;
            img.alt = `Selected photo ${index + 1}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'feedback-remove';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `Remove photo ${index + 1}`);
            remove.addEventListener('click', () => {
                URL.revokeObjectURL(photo.url);
                photos.splice(index, 1);
                renderPreviews();
            });
            item.append(img, remove);
            previews.appendChild(item);
        });
    }

    async function compress(file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            throw new Error('Please choose JPG, PNG or WebP photos.');
        }
        if (file.size > 5 * 1024 * 1024) throw new Error('Each photo must be 5 MB or smaller.');
        const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This picture could not be read. Try a different photo.'); });
        try {
            const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext('2d');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            // Re-encode to JPEG to reduce size and strip camera/location metadata.
            let blob;
            for (const quality of [.82, .65, .45]) {
                blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
                if (blob && blob.size <= 768000) break;
            }
            if (!blob || blob.size > 768000) throw new Error('This photo is too detailed. Please use a smaller picture.');
            const data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = () => reject(new Error('Could not prepare this photo.'));
                reader.readAsDataURL(blob);
            });
            return { data, url: URL.createObjectURL(blob) };
        } finally { bitmap.close(); }
    }

    async function addPhotos(files) {
        if (busy || preparing || !files.length) return;
        if (photos.length + files.length > 3) {
            message('You can add up to 3 photos. Remove one before adding another.', true);
            return;
        }
        preparing = true;
        fields.disabled = true;
        message('Preparing photos…');
        const version = generation;
        try {
            for (const file of files) {
                const photo = await compress(file);
                if (version !== generation) { URL.revokeObjectURL(photo.url); break; }
                photos.push(photo);
            }
            if (version === generation) { renderPreviews(); message('Photos ready.'); }
        } catch (error) {
            if (version === generation) { renderPreviews(); message(error.message, true); }
        } finally {
            preparing = false;
            if (version === generation) fields.disabled = false;
        }
    }

    $('#feedback-files').addEventListener('change', event => {
        const files = Array.from(event.target.files);
        event.target.value = '';
        addPhotos(files);
    });
    dialog.addEventListener('paste', event => {
        const files = Array.from(event.clipboardData?.items || [])
            .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
            .map(item => item.getAsFile()).filter(Boolean);
        if (files.length) { event.preventDefault(); addPhotos(files); }
    });
    form.addEventListener('change', () => {
        const rating = Number(new FormData(form).get('rating'));
        dialog.querySelectorAll('.feedback-stars label').forEach((label, index) => {
            label.classList.toggle('selected', index < rating);
        });
    });

    function appendReview(review, isOwn = false) {
        const article = document.createElement('article');
        article.className = 'feedback-review';
        const head = document.createElement('div');
        head.className = 'feedback-review-head';
        const author = document.createElement('strong');
        author.textContent = review.author_name;
        const stars = document.createElement('span');
        stars.className = 'feedback-review-stars';
        stars.textContent = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
        stars.setAttribute('aria-label', `${review.rating} out of 5 stars`);
        head.append(author, stars);
        if (isOwn) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'feedback-delete';
            remove.textContent = 'Remove';
            remove.setAttribute('aria-label', 'Remove your review');
            head.appendChild(remove);
        }
        const date = document.createElement('time');
        date.className = 'feedback-muted';
        date.dateTime = review.created_at;
        date.textContent = new Date(review.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        const body = document.createElement('p');
        body.textContent = review.body;
        article.append(head, date, body);
        const images = document.createElement('div');
        images.className = 'feedback-photos';
        (review.photo_paths || []).forEach((path, index) => {
            if (!/^[a-z0-9-]+\/[0-9a-f-]+\/[0-2]\.jpg$/.test(path)) return;
            const link = document.createElement('a');
            link.href = PHOTO_BASE + path;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const img = document.createElement('img');
            img.src = link.href;
            img.alt = `${review.author_name}'s photo ${index + 1} of ${current.name}`;
            img.loading = 'lazy';
            link.appendChild(img);
            images.appendChild(link);
        });
        article.appendChild(images);
        list.appendChild(article);
    }

    async function loadReviews(reset = false) {
        const version = generation;
        const id = current.id;
        if (reset) { cursor = null; renderReviewSkeletons(); }
        more.hidden = true;
        more.disabled = true;
        try {
            let own = [];
            if (reset && ownReviewId) {
                own = await api(`/rest/v1/restaurant_reviews?select=id,author_name,rating,body,photo_paths,created_at&id=eq.${ownReviewId}&restaurant_id=eq.${id}`);
            }
            let path = `/rest/v1/restaurant_reviews?select=id,author_name,rating,body,photo_paths,created_at&restaurant_id=eq.${id}`;
            if (ownReviewId) path += `&id=not.eq.${ownReviewId}`;
            path += `&order=created_at.desc,id.desc&limit=${PAGE_SIZE}`;
            if (cursor) path += `&or=${encodeURIComponent(`(created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id}))`)}`;
            const reviews = await api(path);
            if (version !== generation) return;
            if (reset) list.replaceChildren();
            own.forEach(review => appendReview(review, true));
            if (reset && !reviews.length && !own.length) {
                const empty = document.createElement('p');
                empty.className = 'feedback-muted';
                empty.textContent = 'No reviews yet. Help the next person choose what to order.';
                list.appendChild(empty);
            }
            reviews.forEach(review => appendReview(review));
            cursor = reviews.at(-1) || cursor;
            more.textContent = 'Show more reviews';
            more.hidden = reviews.length < PAGE_SIZE;
            more.onclick = () => loadReviews();
        } catch (error) {
            if (version !== generation) return;
            if (reset) list.textContent = error.message;
            else message(error.message, true);
            more.textContent = 'Try again';
            more.hidden = false;
            more.onclick = () => loadReviews(reset);
        } finally { if (version === generation) more.disabled = false; }
    }

    async function openReviews(id, name, trigger) {
        if (trigger?.disabled) return;
        if (trigger) {
            trigger.disabled = true;
            trigger.setAttribute('aria-busy', 'true');
        }
        generation++;
        current = { id, name };
        requestId = crypto.randomUUID();
        clearPhotos();
        form.reset();
        fields.disabled = false;
        ownReviewId = null;
        form.hidden = true;
        renderReviewSkeletons();
        message('');
        $('.feedback-submit').textContent = 'Post review';
        dialog.querySelectorAll('.feedback-stars label').forEach(label => label.classList.remove('selected'));
        $('#feedback-title').textContent = name;
        $('#feedback-summary').textContent = summaryText(id);
        dialog.showModal();
        try {
            // Keep the dialog in its skeleton state until ownership is resolved.
            await checkOwnReview();
            if (!dialog.open || current?.id !== id) return;
            loadReviews(true);
            refreshSummaries();
        } finally {
            if (trigger) {
                trigger.disabled = false;
                trigger.removeAttribute('aria-busy');
            }
        }
    }

    async function ownership(action, reviewId) {
        const token = localStorage.getItem('vnit-feedback-guest');
        if (!token) {
            if (action === 'mine') return { id: null };
            throw new Error('Use the browser you posted from to remove your review.');
        }
        return api('/functions/v1/restaurant-feedback', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_JWT}` },
            body: JSON.stringify({ action, guest_token: token, restaurant_id: current.id, review_id: reviewId }),
        });
    }

    async function checkOwnReview() {
        const version = generation;
        try {
            const result = await ownership('mine');
            if (version !== generation || busy || preparing) return false;
            ownReviewId = result.id;
            form.hidden = !!ownReviewId;
            return true;
        } catch {
            // If the lookup is unavailable, keep the form usable after the dialog opens.
            ownReviewId = null;
            form.hidden = false;
            return false;
        }
    }

    function renderReviewSkeletons() {
        list.replaceChildren(...[1, 2, 3].map(() => {
            const skeleton = document.createElement('div');
            skeleton.className = 'feedback-review-skeleton';
            return skeleton;
        }));
    }

    async function removeOwnReview() {
        if (busy || preparing || !ownReviewId) return;
        busy = true;
        message('Removing your review…');
        $('.feedback-close').disabled = true;
        list.querySelectorAll('.feedback-delete').forEach(button => button.disabled = true);
        try {
            await ownership('remove', ownReviewId);
            ownReviewId = null;
            form.hidden = false;
            form.reset();
            clearPhotos();
            fields.disabled = false;
            requestId = crypto.randomUUID();
            dialog.querySelectorAll('.feedback-stars label').forEach(label => label.classList.remove('selected'));
            $('.feedback-submit').textContent = 'Post review';
            message('Your review and photos have been removed.');
            await Promise.all([refreshSummaries(), loadReviews(true)]);
        } catch (error) {
            message(error.message, true);
        } finally {
            busy = false;
            list.querySelectorAll('.feedback-delete').forEach(button => button.disabled = false);
            $('.feedback-close').disabled = false;
        }
    }
    list.addEventListener('click', event => {
        if (event.target.closest('.feedback-delete')) removeOwnReview();
    });

    function closeReviews() {
        if (busy || preparing) return;
        dialog.close();
    }
    $('.feedback-close').addEventListener('click', closeReviews);
    dialog.addEventListener('cancel', event => { if (busy || preparing) event.preventDefault(); });
    dialog.addEventListener('close', () => { generation++; clearPhotos(); current = null; });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || preparing || !form.reportValidity()) return;
        const rating = Number(new FormData(form).get('rating'));
        if (rating < 1 || rating > 5) { message('Choose a rating from 1 to 5 stars.', true); return; }
        let guestToken;
        try {
            guestToken = localStorage.getItem('vnit-feedback-guest');
            if (!guestToken) {
                guestToken = crypto.randomUUID();
                localStorage.setItem('vnit-feedback-guest', guestToken);
            }
        } catch { message('Allow site storage in your browser to post a guest review.', true); return; }
        busy = true;
        fields.disabled = true;
        $('.feedback-close').disabled = true;
        $('.feedback-submit').textContent = 'Posting…';
        message('Saving your review…');
        let posted = false;
        try {
            const result = await api('/functions/v1/restaurant-feedback', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_JWT}` },
                body: JSON.stringify({
                    request_id: requestId, guest_token: guestToken, restaurant_id: current.id, rating,
                    author_name: $('#feedback-name').value.trim(), body: $('#feedback-body').value.trim(),
                    photos: photos.map(photo => photo.data),
                }),
            });
            posted = true;
            ownReviewId = result.id;
            form.hidden = true;
            clearPhotos();
            message('Thank you! Your review is now part of the guide.');
            $('.feedback-submit').textContent = 'Review posted';
            await Promise.all([refreshSummaries(), loadReviews(true)]);
        } catch (error) {
            message(error.message, true);
            $('.feedback-submit').textContent = 'Try posting again';
        } finally {
            busy = false;
            fields.disabled = posted;
            $('.feedback-close').disabled = false;
        }
    });

    // Restaurant suggestions are private requests for the guide owner to review.
    const requestDialog = document.createElement('dialog');
    requestDialog.className = 'feedback-dialog';
    requestDialog.setAttribute('aria-labelledby', 'restaurant-request-title');
    const types = ['Biryani', 'Shawarma', 'Mughlai & North Indian', 'Tandoor & Kebabs',
        'Fried Chicken & Burgers', 'Sandwiches & Wraps', 'Veg / South Indian',
        'Burgers', 'Momos & Noodles', 'Café & Desserts', 'Other'];
    requestDialog.innerHTML = `
        <div class="feedback-heading">
            <div><p class="feedback-muted">HELP THE GUIDE GROW</p><h2 id="restaurant-request-title">Suggest a restaurant</h2></div>
            <button type="button" class="feedback-close" aria-label="Close restaurant request">×</button>
        </div>
        <p class="feedback-request-intro feedback-muted">Know a place worth adding? Send its details for review.</p>
        <form class="feedback-form">
            <fieldset>
                <label for="request-name">Restaurant name <span aria-hidden="true">*</span></label>
                <input id="request-name" class="feedback-input" required minlength="2" maxlength="120" autocomplete="off">
                <label for="request-listing">Zomato / Swiggy listing <span class="feedback-muted">(optional)</span></label>
                <input id="request-listing" class="feedback-input" type="url" maxlength="1000" placeholder="https://www.zomato.com/…">
                <label for="request-location">Location — address or map link <span aria-hidden="true">*</span></label>
                <textarea id="request-location" class="feedback-input" required minlength="2" maxlength="500" placeholder="Area, address, or a Google Maps link"></textarea>
                <label for="request-type">Restaurant type <span aria-hidden="true">*</span></label>
                <select id="request-type" class="feedback-input" required>
                    <option value="">Choose a type</option>
                    ${types.map(type => `<option value="${type.replaceAll('&', '&amp;')}">${type.replaceAll('&', '&amp;')}</option>`).join('')}
                </select>
                <div id="request-other-wrap" hidden>
                    <label for="request-other">Other restaurant type <span aria-hidden="true">*</span></label>
                    <input id="request-other" class="feedback-input" minlength="2" maxlength="80" placeholder="What is this place known for?" disabled>
                </div>
                <p class="feedback-muted">Required fields are marked *. Suggestions are reviewed before being added.</p>
                <button class="feedback-submit" type="submit">Send request</button>
            </fieldset>
            <p class="feedback-status" role="status" aria-live="polite"></p>
        </form>`;
    document.body.appendChild(requestDialog);
    const rq = selector => requestDialog.querySelector(selector);
    const requestForm = rq('form');
    const requestFields = rq('fieldset');
    const requestStatus = rq('.feedback-status');
    const requestButton = document.createElement('button');
    requestButton.type = 'button';
    requestButton.className = 'feedback-more restaurant-request-open';
    requestButton.textContent = 'Suggest a restaurant';
    requestButton.setAttribute('aria-haspopup', 'dialog');
    document.querySelector('#food-scene .accordion-body > p').after(requestButton);
    let suggestionId = null;
    let sendingRequest = false;
    requestButton.addEventListener('click', () => {
        requestForm.reset();
        requestFields.disabled = false;
        requestStatus.textContent = '';
        requestStatus.dataset.error = 'false';
        rq('#request-other-wrap').hidden = true;
        rq('#request-other').disabled = true;
        rq('#request-other').required = false;
        rq('.feedback-submit').textContent = 'Send request';
        suggestionId = crypto.randomUUID();
        requestDialog.showModal();
    });
    rq('.feedback-close').addEventListener('click', () => { if (!sendingRequest) requestDialog.close(); });
    requestDialog.addEventListener('cancel', event => { if (sendingRequest) event.preventDefault(); });
    rq('#request-type').addEventListener('change', () => {
        const other = rq('#request-type').value === 'Other';
        rq('#request-other-wrap').hidden = !other;
        rq('#request-other').disabled = !other;
        rq('#request-other').required = other;
        if (other) rq('#request-other').focus();
    });
    requestForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (sendingRequest || !requestForm.reportValidity()) return;
        const name = rq('#request-name').value.trim();
        const location = rq('#request-location').value.trim();
        const type = rq('#request-type').value === 'Other' ? rq('#request-other').value.trim() : rq('#request-type').value;
        if (name.length < 2 || location.length < 2 || type.length < 2) {
            requestStatus.textContent = 'Please fill in the restaurant name, location and type.';
            requestStatus.dataset.error = 'true';
            return;
        }
        sendingRequest = true;
        requestFields.disabled = true;
        rq('.feedback-close').disabled = true;
        rq('.feedback-submit').textContent = 'Sending…';
        requestStatus.textContent = '';
        let received = false;
        try {
            let token = localStorage.getItem('vnit-feedback-guest');
            if (!token) {
                token = crypto.randomUUID();
                localStorage.setItem('vnit-feedback-guest', token);
            }
            await api('/functions/v1/restaurant-requests', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_JWT}` },
                body: JSON.stringify({ request_id: suggestionId, guest_token: token, restaurant_name: name,
                    listing_url: rq('#request-listing').value.trim(), location, restaurant_type: type }),
            });
            received = true;
            requestStatus.textContent = 'Thank you! Your restaurant suggestion has been received for review.';
            requestStatus.dataset.error = 'false';
            rq('.feedback-submit').textContent = 'Request received';
        } catch (error) {
            requestStatus.textContent = error.message;
            requestStatus.dataset.error = 'true';
            rq('.feedback-submit').textContent = 'Try again';
        } finally {
            sendingRequest = false;
            requestFields.disabled = received;
            rq('.feedback-close').disabled = false;
        }
    });

    refreshSummaries();
    // Pick up other visitors' reviews when returning to the guide.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshSummaries();
    });
})();
