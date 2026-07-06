// Ad-hoc real-world verification for the thumbnail port. Not part of the
// test suite; run with:
//   cargo run --example verify_thumbnails -- <ffmpeg_bin> <video_path> <image_url>
use app_lib::thumbnails::verify_support::{fetch_remote_for_verify, generate_local_for_verify};

#[tokio::main]
async fn main() {
    let ffmpeg_bin = std::env::args().nth(1).expect("pass the ffmpeg binary path");
    let video_path = std::env::args().nth(2).expect("pass a video file path");
    let image_url = std::env::args().nth(3).expect("pass an image URL");

    println!("=== loadLibraryThumbnail (ffmpeg frame extraction) ===");
    match generate_local_for_verify(&ffmpeg_bin, &video_path).await {
        Ok(data_url) => {
            let prefix_len = data_url.find(',').unwrap_or(30).min(30);
            println!("ok: prefix={} total_len={}", &data_url[..prefix_len], data_url.len());
        }
        Err(e) => println!("FAILED: {e}"),
    }

    println!("=== loadThumbnail (remote fetch) ===");
    match fetch_remote_for_verify(&image_url).await {
        Ok((src, url)) => {
            let prefix_len = src.find(',').unwrap_or(30).min(30);
            println!("ok: url={url} prefix={} total_len={}", &src[..prefix_len], src.len());
        }
        Err(e) => println!("FAILED: {e}"),
    }
}
