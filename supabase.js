// supabase.js — online database layer for Supabase.
// Configure your Supabase project URL and anon key below.
//
// Expected Supabase schema:
// profiles: username text primary key, history jsonb, searches jsonb, liked_videos jsonb
// videos: id int primary key, title text, driveId text, likes int default 0

const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const USE_SUPABASE =
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes("YOUR_PROJECT") &&
  !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY");

let supabaseClient = null;

function createSupabaseClient(){
  if(!window.supabase){
    console.warn("Supabase library not loaded.");
    return null;
  }

  return supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function getLocalAccount(){
  return JSON.parse(localStorage.getItem("account") || "null");
}

function saveLocalAccount(account){
  localStorage.setItem("account", JSON.stringify(account));
}

async function initSupabase(){
  if(!USE_SUPABASE){
    console.warn("Supabase is not configured, using local fallback.");
    return false;
  }

  if(!supabaseClient){
    supabaseClient = createSupabaseClient();
  }

  return !!supabaseClient;
}

async function getVideos(){
  if(!await initSupabase()){
    const jsonVideos = await fetch("videos.json").then(res => res.json()).catch(() => []);
    const uploadedVideos = JSON.parse(localStorage.getItem("uploadedVideos") || "[]");
    return [
      ...jsonVideos,
      ...uploadedVideos
    ];
  }

  const { data, error } = await supabaseClient
    .from("videos")
    .select("*")
    .order("id", { ascending: true });

  if(error){
    console.error("Supabase getVideos error:", error);
    return [];
  }

  return data || [];
}

async function getVideoById(id){
  if(!await initSupabase()){
    const jsonVideos = await fetch("videos.json").then(res => res.json()).catch(() => []);
    const uploadedVideos = JSON.parse(localStorage.getItem("uploadedVideos") || "[]");
    const videos = [
      ...jsonVideos,
      ...uploadedVideos
    ];
    return videos.find(v => String(v.id) === String(id)) || null;
  }

  const { data, error } = await supabaseClient
    .from("videos")
    .select("*")
    .eq("id", id)
    .single();

  if(error){
    console.error("Supabase getVideoById error:", error);
    return null;
  }

  return data;
}

async function getProfile(username){
  if(!username){
    return null;
  }

  if(!await initSupabase()){
    return getLocalAccount();
  }

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("username", username)
    .single();

  if(error){
    if(error.code === "PGRST116" || error.details?.includes("result contains no rows")){
      return null;
    }
    console.error("Supabase getProfile error:", error);
    return null;
  }

  return data;
}

async function createProfile(username){
  if(!username){
    return null;
  }

  if(!await initSupabase()){
    const account = { username, history: [], searches: [], liked_videos: [] };
    saveLocalAccount(account);
    return account;
  }

  const existing = await getProfile(username);
  if(existing){
    return existing;
  }

  const { data, error } = await supabaseClient
    .from("profiles")
    .insert({
      username,
      history: [],
      searches: [],
      liked_videos: []
    })
    .single();

  if(error){
    console.error("Supabase createProfile error:", error);
    return null;
  }

  return data;
}

async function upsertProfile(profile){
  if(!profile || !profile.username){
    return null;
  }

  if(!await initSupabase()){
    saveLocalAccount(profile);
    return profile;
  }

  const { data, error } = await supabaseClient
    .from("profiles")
    .upsert(profile, { onConflict: "username" })
    .single();

  if(error){
    console.error("Supabase upsertProfile error:", error);
    return null;
  }

  return data;
}

async function loginAndSync(username){
  if(!username){
    return null;
  }

  const account = { username };
  saveLocalAccount(account);

  if(!await initSupabase()){
    return account;
  }

  const profile = await getProfile(username);
  if(profile){
    return profile;
  }

  return await createProfile(username);
}

async function recordHistory(username, videoId){
  if(!username){
    return;
  }

  if(!await initSupabase()){
    const account = getLocalAccount();
    if(!account || !account.history){
      return;
    }
    if(!account.history.includes(videoId)){
      account.history.push(videoId);
      saveLocalAccount(account);
    }
    return;
  }

  const profile = await getProfile(username);
  if(!profile){
    return;
  }

  const history = Array.isArray(profile.history) ? profile.history : [];
  if(!history.includes(videoId)){
    history.push(videoId);
    await upsertProfile({ ...profile, history });
  }
}

async function toggleLike(username, videoId){
  if(!username){
    return null;
  }

  if(!await initSupabase()){
    let likedVideos = JSON.parse(localStorage.getItem("likedVideos") || "[]");
    if(likedVideos.includes(videoId)){
      likedVideos = likedVideos.filter(v => v !== videoId);
    } else {
      likedVideos.push(videoId);
    }
    localStorage.setItem("likedVideos", JSON.stringify(likedVideos));
    return likedVideos;
  }

  const profile = await getProfile(username);
  if(!profile){
    return null;
  }

  let likedVideos = Array.isArray(profile.liked_videos) ? profile.liked_videos : [];
  const hasLiked = likedVideos.includes(videoId);
  if(hasLiked){
    likedVideos = likedVideos.filter(v => v !== videoId);
  } else {
    likedVideos.push(videoId);
  }

  await upsertProfile({ ...profile, liked_videos: likedVideos });

  const delta = hasLiked ? -1 : 1;
  await updateVideoLikes(videoId, delta);

  return likedVideos;
}

async function updateVideoLikes(videoId, delta){
  if(!await initSupabase()){
    return;
  }

  const video = await getVideoById(videoId);
  if(!video){
    return;
  }

  const newLikes = Math.max(0, Number(video.likes || 0) + delta);
  const { data, error } = await supabaseClient
    .from("videos")
    .update({ likes: newLikes })
    .eq("id", videoId);

  if(error){
    console.error("Supabase updateVideoLikes error:", error);
  }

  return data;
}

async function storeSearch(username, search){
  if(!username || !search){
    return;
  }

  if(!await initSupabase()){
    const account = getLocalAccount();
    if(!account){
      return;
    }
    account.searches = account.searches || [];
    account.searches.push(search);
    saveLocalAccount(account);
    return;
  }

  const profile = await getProfile(username);
  if(!profile){
    return;
  }

  const searches = Array.isArray(profile.searches) ? profile.searches : [];
  searches.push(search);
  await upsertProfile({ ...profile, searches });
}

function getStoredAccount(){
  return getLocalAccount();
}

window.supabaseHelpers = {
  initSupabase,
  getVideos,
  getVideoById,
  getProfile,
  createProfile,
  upsertProfile,
  loginAndSync,
  recordHistory,
  toggleLike,
  storeSearch,
  getStoredAccount,
  USE_SUPABASE
};
