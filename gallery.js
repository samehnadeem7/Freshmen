(() => {
    'use strict';

    const GALLERY_EVENTS = window.VNIT_GALLERY_EVENTS || [];

    const root = document.querySelector('.gallery-accordion-item');
    if (!root) return;
    const filters = root.querySelector('.gallery-filters');
    const occasions = root.querySelector('.gallery-occasions');
    let events = normalizeEvents(GALLERY_EVENTS);
    let selectedFilter = 'all';
    let activeObservers = [];
    let visiblePhotos = [];
    let currentPhotoIndex = 0;
    let lastPhotoLink = null;

    const viewer = document.createElement('dialog');
    viewer.className = 'gallery-viewer';
    viewer.setAttribute('aria-label', 'Gallery photo viewer');
    viewer.innerHTML = `
        <div class="gallery-viewer-stage">
            <button type="button" class="gallery-viewer-arrow gallery-viewer-prev" aria-label="Previous photo">‹</button>
            <div class="gallery-viewer-image-wrap"><img alt=""></div>
            <button type="button" class="gallery-viewer-arrow gallery-viewer-next" aria-label="Next photo">›</button>
        </div>`;
    document.body.append(viewer);
    const viewerImage = viewer.querySelector('img');
    const previous = viewer.querySelector('.gallery-viewer-prev');
    const next = viewer.querySelector('.gallery-viewer-next');

    function showPhoto(index) {
        if (index < 0 || index >= visiblePhotos.length) return;
        currentPhotoIndex = index;
        const { event, photo } = visiblePhotos[index];
        viewerImage.hidden = true;
        viewerImage.alt = photo.alt || event.occasion;
        viewerImage.src = photo.src;
        previous.disabled = index === 0;
        next.disabled = index === visiblePhotos.length - 1;
    }

    viewerImage.addEventListener('load', () => { viewerImage.hidden = false; });
    viewerImage.addEventListener('error', () => { viewerImage.hidden = true; });
    previous.addEventListener('click', () => showPhoto(currentPhotoIndex - 1));
    next.addEventListener('click', () => showPhoto(currentPhotoIndex + 1));
    viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
    viewer.addEventListener('close', () => lastPhotoLink?.focus());
    viewer.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); showPhoto(currentPhotoIndex - 1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); showPhoto(currentPhotoIndex + 1); }
    });
    let touchStartX = 0;
    viewer.querySelector('.gallery-viewer-stage').addEventListener('touchstart', event => { touchStartX = event.changedTouches[0].screenX; }, { passive: true });
    viewer.querySelector('.gallery-viewer-stage').addEventListener('touchend', event => {
        const distance = event.changedTouches[0].screenX - touchStartX;
        if (Math.abs(distance) > 50) showPhoto(currentPhotoIndex + (distance < 0 ? 1 : -1));
    }, { passive: true });

    function dateLabel(value) {
        const date = new Date(`${value.length === 7 ? `${value}-01` : value}T12:00:00`);
        return date.toLocaleDateString('en-IN', value.length === 7
            ? { month: 'long', year: 'numeric' }
            : { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function makePhoto(photo, event) {
        const figure = document.createElement('figure');
        figure.className = 'gallery-photo';
        const link = document.createElement('a');
        link.href = photo.src;
        link.setAttribute('aria-label', `Enlarge photo: ${photo.alt || event.occasion}`);
        link.addEventListener('click', click => {
            click.preventDefault();
            lastPhotoLink = link;
            const index = visiblePhotos.findIndex(item => item.photo === photo);
            if (index < 0) return;
            showPhoto(index);
            viewer.showModal();
        });
        const image = document.createElement('img');
        image.src = photo.src;
        image.alt = photo.alt || event.occasion;
        image.loading = 'lazy';
        image.addEventListener('error', () => {
            link.classList.add('gallery-image-unavailable');
            image.remove();
            const fallback = document.createElement('span');
            fallback.textContent = 'Photo unavailable';
            link.append(fallback);
        }, { once: true });
        link.append(image);
        if (photo.label) {
            const label = document.createElement('span');
            label.className = 'gallery-photo-label';
            label.textContent = photo.label;
            link.append(label);
        }
        figure.append(link);
        return figure;
    }

    function makeOccasion(event) {
        const section = document.createElement('section');
        section.className = 'gallery-occasion';
        const heading = document.createElement('div');
        heading.className = 'gallery-occasion-heading';
        const details = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = event.occasion;
        const date = document.createElement('time');
        date.dateTime = event.date;
        date.textContent = dateLabel(event.date);
        details.append(title);

        const controls = document.createElement('div');
        controls.className = 'gallery-scroll-controls';
        const track = document.createElement('div');
        track.className = 'gallery-track';
        track.setAttribute('aria-label', `${event.occasion} photos`);
        track.tabIndex = 0;
        event.photos.forEach(photo => track.append(makePhoto(photo, event)));
        if (!event.photos.length) {
            const empty = document.createElement('p');
            empty.className = 'gallery-empty';
            empty.textContent = 'Photos coming soon.';
            track.append(empty);
        }

        for (const [direction, label, symbol] of [[-1, 'Scroll photos left', '←'], [1, 'Scroll photos right', '→']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'gallery-scroll-button';
            button.textContent = symbol;
            button.setAttribute('aria-label', `${label} for ${event.occasion}`);
            button.addEventListener('click', () => track.scrollBy({ left: direction * Math.max(track.clientWidth * .8, 220), behavior: 'smooth' }));
            controls.append(button);
        }
        const updateControls = () => {
            const [left, right] = controls.children;
            left.disabled = track.scrollLeft <= 1;
            right.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
            controls.hidden = track.scrollWidth <= track.clientWidth + 1;
        };
        track.addEventListener('scroll', updateControls, { passive: true });
        const meta = document.createElement('div');
        meta.className = 'gallery-occasion-meta';
        meta.append(date, controls);
        heading.append(details, meta);
        section.append(heading, track);
        const observer = new ResizeObserver(updateControls);
        observer.observe(track);
        activeObservers.push(observer);
        requestAnimationFrame(updateControls);
        return section;
    }

    function render() {
        filters.replaceChildren();
        const years = [...new Set([2025, 2026, ...events.map(event => Number(event.date.slice(0, 4)))])].sort((a, b) => b - a);
        const tags = [...new Set(events.map(event => event.tag).filter(Boolean))];
        for (const option of [{ value: 'all', label: 'All' }, ...years.map(year => ({ value: String(year), label: String(year) })), ...tags.map(tag => ({ value: `tag:${tag}`, label: tag }))]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'gallery-filter';
            button.textContent = option.label;
            button.setAttribute('aria-pressed', String(selectedFilter === option.value));
            button.addEventListener('click', () => {
                selectedFilter = option.value;
                render();
            });
            filters.append(button);
        }

        activeObservers.forEach(observer => observer.disconnect());
        activeObservers = [];
        occasions.replaceChildren();
        const visible = events.filter(event => selectedFilter === 'all' ||
            (selectedFilter.startsWith('tag:') ? event.tag === selectedFilter.slice(4) : event.date.slice(0, 4) === selectedFilter));
        visiblePhotos = visible.flatMap(event => event.photos.map(photo => ({ event, photo })));
        if (!visible.length) {
            const empty = document.createElement('p');
            empty.className = 'gallery-empty';
            empty.textContent = events.length ? 'No photos in this collection yet.' : 'Photos will appear here soon.';
            occasions.append(empty);
            return;
        }
        visible.forEach(event => occasions.append(makeOccasion(event)));
    }

    function normalizeEvents(items) {
        return (Array.isArray(items) ? items : [])
            .filter(event => event && /^\d{4}-\d{2}(?:-\d{2})?$/.test(event.date) && Array.isArray(event.photos))
            .sort((a, b) => b.date.localeCompare(a.date));
    }

    window.VNIT_GALLERY_SET_EVENTS = items => {
        events = normalizeEvents(items);
        selectedFilter = 'all';
        render();
    };

    render();
})();
