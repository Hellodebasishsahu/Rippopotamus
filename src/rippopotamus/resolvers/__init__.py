from rippopotamus.resolvers.base import IndexAdapter, PlayableLink, resolve_all
from rippopotamus.resolvers.internet_archive import InternetArchiveAdapter
from rippopotamus.resolvers.yt_dlp_search import YtDlpYouTubeAdapter

ADAPTERS: list[IndexAdapter] = [InternetArchiveAdapter(), YtDlpYouTubeAdapter()]

__all__ = ["IndexAdapter", "PlayableLink", "ADAPTERS", "resolve_all"]
