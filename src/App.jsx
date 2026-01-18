import React, { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// SUPABASE CLIENT
// Replace these with your actual Supabase project credentials
// ============================================================================
const SUPABASE_URL = 'https://guhqkluzbddamhagqjvx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1aHFrbHV6YmRkYW1oYWdxanZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NzIzNTUsImV4cCI6MjA4NDM0ODM1NX0.m-G-ihIH6M9MEdPUT_RiENKAT5qdpEUVfIp_26F3Jy0';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================================
// AUTH CONTEXT
// ============================================================================
const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active sessions
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    return { data, error };
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

// ============================================================================
// DATABASE HOOKS
// ============================================================================

const useRestaurants = () => {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRestaurants = async () => {
      const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .order('name');
      
      if (!error) setRestaurants(data);
      setLoading(false);
    };
    fetchRestaurants();
  }, []);

  return { restaurants, loading };
};

const useUserPreferences = (userId) => {
  const [preferences, setPreferences] = useState(null);
  const [cuisinePrefs, setCuisinePrefs] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    const fetchPreferences = async () => {
      // Fetch ranking preferences
      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (prefs) {
        setPreferences({
          food: prefs.food_rank ? 5 - prefs.food_rank + 1 : 0,
          service: prefs.service_rank ? 5 - prefs.service_rank + 1 : 0,
          vibe: prefs.vibe_rank ? 5 - prefs.vibe_rank + 1 : 0,
          value: prefs.value_rank ? 5 - prefs.value_rank + 1 : 0,
        });
      }

      // Fetch cuisine preferences
      const { data: cuisines } = await supabase
        .from('cuisine_preferences')
        .select('*')
        .eq('user_id', userId);

      if (cuisines) {
        const prefsMap = {};
        cuisines.forEach(c => { prefsMap[c.cuisine_type] = c.preference; });
        setCuisinePrefs(prefsMap);
      }

      setLoading(false);
    };

    fetchPreferences();
  }, [userId]);

  const savePreferences = async (newPrefs) => {
    const rankings = Object.entries(newPrefs)
      .sort(([, a], [, b]) => b - a)
      .reduce((acc, [key], idx) => {
        acc[`${key}_rank`] = idx + 1;
        return acc;
      }, {});

    const { error } = await supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        ...rankings,
      });

    if (!error) setPreferences(newPrefs);
    return { error };
  };

  const saveCuisinePrefs = async (newCuisinePrefs) => {
    const entries = Object.entries(newCuisinePrefs);
    
    for (const [cuisineType, preference] of entries) {
      await supabase
        .from('cuisine_preferences')
        .upsert({
          user_id: userId,
          cuisine_type: cuisineType,
          preference,
        });
    }

    setCuisinePrefs(newCuisinePrefs);
  };

  return { preferences, cuisinePrefs, loading, savePreferences, saveCuisinePrefs };
};

const useRatings = (userId) => {
  const [userRatings, setUserRatings] = useState({});
  const [allRatings, setAllRatings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRatings = async () => {
      // Fetch all ratings (for collaborative filtering)
      const { data: all } = await supabase
        .from('ratings')
        .select('*');

      if (all) setAllRatings(all);

      // Fetch current user's ratings
      if (userId) {
        const { data: mine } = await supabase
          .from('ratings')
          .select('*')
          .eq('user_id', userId);

        if (mine) {
          const ratingsMap = {};
          mine.forEach(r => {
            ratingsMap[r.restaurant_id] = {
              overall: r.overall,
              food: r.food,
              service: r.service,
              vibe: r.vibe,
              value: r.value,
              notes: r.notes,
            };
          });
          setUserRatings(ratingsMap);
        }
      }

      setLoading(false);
    };

    fetchRatings();
  }, [userId]);

  const saveRating = async (restaurantId, rating) => {
    const { error } = await supabase
      .from('ratings')
      .upsert({
        user_id: userId,
        restaurant_id: restaurantId,
        overall: rating.overall,
        food: rating.food || null,
        service: rating.service || null,
        vibe: rating.vibe || null,
        value: rating.value || null,
        notes: rating.notes || null,
      });

    if (!error) {
      setUserRatings(prev => ({ ...prev, [restaurantId]: rating }));
      
      // Also update allRatings
      setAllRatings(prev => {
        const filtered = prev.filter(r => !(r.user_id === userId && r.restaurant_id === restaurantId));
        return [...filtered, { user_id: userId, restaurant_id: restaurantId, ...rating }];
      });
    }

    return { error };
  };

  return { userRatings, allRatings, loading, saveRating };
};

// ============================================================================
// COLLABORATIVE FILTERING ALGORITHM
// ============================================================================

const CollaborativeFilter = {
  getDynamicWeights: (preferences) => {
    if (!preferences) return { food: 0.35, service: 0.2, vibe: 0.25, value: 0.2 };
    const total = Object.values(preferences).reduce((a, b) => a + (b || 0), 0);
    if (total === 0) return { food: 0.35, service: 0.2, vibe: 0.25, value: 0.2 };
    return {
      food: (preferences.food || 0) / total,
      service: (preferences.service || 0) / total,
      vibe: (preferences.vibe || 0) / total,
      value: (preferences.value || 0) / total,
    };
  },

  getOverallScore: (rating, preferences) => {
    if (!rating) return 0;
    if (rating.overall) {
      const weights = CollaborativeFilter.getDynamicWeights(preferences);
      const hasOtherRatings = ['food', 'service', 'vibe', 'value'].some(k => rating[k] > 0);
      if (hasOtherRatings) {
        const calculatedScore = Object.entries(weights).reduce((sum, [key, weight]) => 
          sum + (rating[key] || 0) * weight, 0
        );
        return rating.overall * 0.5 + calculatedScore * 0.5;
      }
      return rating.overall;
    }
    const weights = CollaborativeFilter.getDynamicWeights(preferences);
    return Object.entries(weights).reduce((sum, [key, weight]) => 
      sum + (rating[key] || 0) * weight, 0
    );
  },

  calculateSimilarity: (user1Ratings, user2Ratings, commonRestaurants, preferences) => {
    if (commonRestaurants.length === 0) return 0.1;
    if (commonRestaurants.length === 1) {
      const r1 = user1Ratings[commonRestaurants[0]];
      const r2 = user2Ratings[commonRestaurants[0]];
      const s1 = CollaborativeFilter.getOverallScore(r1, preferences);
      const s2 = CollaborativeFilter.getOverallScore(r2, preferences);
      const diff = Math.abs(s1 - s2);
      return Math.max(0.1, (1 - diff / 4) * 0.5);
    }

    const scores1 = commonRestaurants.map(id => CollaborativeFilter.getOverallScore(user1Ratings[id], preferences));
    const scores2 = commonRestaurants.map(id => CollaborativeFilter.getOverallScore(user2Ratings[id], preferences));

    const mean1 = scores1.reduce((a, b) => a + b, 0) / scores1.length;
    const mean2 = scores2.reduce((a, b) => a + b, 0) / scores2.length;

    let numerator = 0, denom1 = 0, denom2 = 0;
    for (let i = 0; i < scores1.length; i++) {
      const diff1 = scores1[i] - mean1;
      const diff2 = scores2[i] - mean2;
      numerator += diff1 * diff2;
      denom1 += diff1 * diff1;
      denom2 += diff2 * diff2;
    }

    const correlation = (denom1 === 0 || denom2 === 0) ? 0.5 : numerator / Math.sqrt(denom1 * denom2);
    return Math.max(0.1, correlation);
  },

  predictRating: (restaurant, userId, userRatings, allRatings, preferences, cuisinePrefs) => {
    // Start with baseline rating
    let prediction = restaurant.baseline_rating || 4.0;

    // Apply cuisine preference adjustments
    const cuisinePref = cuisinePrefs?.[restaurant.cuisine_type];
    const cuisineAdjustment = 
      cuisinePref === -2 ? -1.25 : 
      cuisinePref === -1 ? -0.75 : 
      cuisinePref === 2 ? 0.35 : 
      cuisinePref === 1 ? 0.2 : 0;

    prediction += cuisineAdjustment;

    // Group ratings by user
    const userRatingsMap = {};
    allRatings.forEach(r => {
      if (!userRatingsMap[r.user_id]) userRatingsMap[r.user_id] = {};
      userRatingsMap[r.user_id][r.restaurant_id] = r;
    });

    // Find similar users who rated this restaurant
    const similarUsers = [];
    const myRestaurantIds = Object.keys(userRatings).map(Number);

    Object.entries(userRatingsMap).forEach(([otherUserId, otherRatings]) => {
      if (otherUserId === userId) return;
      if (!otherRatings[restaurant.id]) return;

      const otherRestaurantIds = Object.keys(otherRatings).map(Number);
      const commonIds = myRestaurantIds.filter(id => otherRestaurantIds.includes(id));

      const similarity = CollaborativeFilter.calculateSimilarity(
        userRatings, otherRatings, commonIds, preferences
      );

      if (similarity > 0) {
        similarUsers.push({ userId: otherUserId, similarity, rating: otherRatings[restaurant.id] });
      }
    });

    // Calculate weighted prediction from similar users
    if (similarUsers.length > 0) {
      let weightedSum = 0, weightTotal = 0;
      similarUsers.forEach(({ similarity, rating }) => {
        const score = CollaborativeFilter.getOverallScore(rating, preferences);
        weightedSum += similarity * score;
        weightTotal += Math.abs(similarity);
      });

      if (weightTotal > 0) {
        const collaborativeScore = weightedSum / weightTotal;
        // Blend baseline with collaborative (more collaborative as more data)
        const blendWeight = Math.min(similarUsers.length / 5, 0.7);
        prediction = prediction * (1 - blendWeight) + collaborativeScore * blendWeight;
      }
    }

    // Apply preference-based adjustments
    const weights = CollaborativeFilter.getDynamicWeights(preferences);
    if (weights.value > 0.3 && restaurant.price_tier >= 3) {
      prediction -= 0.15;
    }
    if (weights.vibe > 0.3 && ['fine', 'upscale'].includes(restaurant.dining_style)) {
      prediction += 0.1;
    }

    return Math.max(1, Math.min(5, prediction));
  },
};

// ============================================================================
// UI COMPONENTS
// ============================================================================

const StarRating = ({ value, onChange, size = 'md', label, showValue = false }) => {
  const [hover, setHover] = useState(0);
  const starSize = { sm: 18, md: 28, lg: 36 };
  
  const handleClick = (starIndex, isHalf) => {
    if (!onChange) return;
    const newValue = isHalf ? starIndex + 0.5 : starIndex + 1;
    onChange(newValue);
  };
  
  const handleMouseMove = (e, starIndex) => {
    if (!onChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isHalf = x < rect.width / 2;
    setHover(isHalf ? starIndex + 0.5 : starIndex + 1);
  };
  
  const displayValue = hover || value;
  
  const renderStar = (starIndex) => {
    const starNumber = starIndex + 1;
    const fillLevel = displayValue >= starNumber ? 'full' : displayValue >= starNumber - 0.5 ? 'half' : 'empty';
    const sz = starSize[size];
    
    return (
      <button
        key={starIndex}
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          handleClick(starIndex, x < rect.width / 2);
        }}
        onMouseMove={(e) => handleMouseMove(e, starIndex)}
        onMouseLeave={() => setHover(0)}
        className={`transition-all duration-150 ${onChange ? 'cursor-pointer hover:scale-110' : 'cursor-default'}`}
        disabled={!onChange}
        style={{ width: sz, height: sz, position: 'relative' }}
      >
        <svg viewBox="0 0 24 24" style={{ width: '100%', height: '100%' }}>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#D4C4B0" />
          {fillLevel !== 'empty' && (
            <path 
              d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
              fill="#C4956A"
              style={fillLevel === 'half' ? { clipPath: 'inset(0 50% 0 0)' } : undefined}
            />
          )}
        </svg>
      </button>
    );
  };
  
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-xs uppercase tracking-wider" style={{ color: '#8B7355' }}>{label}</span>}
      <div className="flex gap-0.5 items-center">
        {[0, 1, 2, 3, 4].map(renderStar)}
        {showValue && value > 0 && (
          <span className="ml-2 text-sm font-medium" style={{ color: '#6B5744' }}>{value}/5</span>
        )}
      </div>
    </div>
  );
};

const DINING_STYLE_LABELS = {
  fine: 'Fine Dining',
  upscale: 'Upscale Casual',
  casual: 'Casual',
  fast_casual: 'Fast Casual',
};

const CategoryBadge = ({ diningStyle, priceTier }) => {
  const prices = ['$', '$$', '$$$', '$$$$'];
  return (
    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F5EFE6', color: '#8B7355' }}>
      {DINING_STYLE_LABELS[diningStyle]} • {prices[priceTier - 1]}
    </span>
  );
};

const Logo = ({ size = 80 }) => (
  <div style={{ width: size, height: size, backgroundColor: '#1C2127', borderRadius: size > 60 ? 16 : 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: size > 60 ? 12 : 6 }}>
    <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
      <ellipse cx="50" cy="62" rx="35" ry="10" fill="none" stroke="#C9A868" strokeWidth="2.5"/>
      <path d="M15 62 Q20 85 50 85 Q80 85 85 62" fill="none" stroke="#C9A868" strokeWidth="2.5"/>
      <path d="M35 50 Q30 35 38 20" fill="none" stroke="#C9A868" strokeWidth="2" strokeLinecap="round"/>
      <path d="M50 45 Q45 28 53 12" fill="none" stroke="#C9A868" strokeWidth="2" strokeLinecap="round"/>
      <path d="M65 50 Q60 35 68 20" fill="none" stroke="#C9A868" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  </div>
);

const AppName = ({ size = 'md', light = false }) => {
  const sizes = { sm: '1.25rem', md: '1.5rem', lg: '2.25rem' };
  return (
    <span style={{ color: light ? '#E8D4B8' : '#4A3728', fontFamily: 'Palatino, "Palatino Linotype", Georgia, serif', fontWeight: 300, letterSpacing: '0.05em', fontSize: sizes[size] }}>
      Epicura
    </span>
  );
};

// ============================================================================
// AUTH SCREENS
// ============================================================================

const AuthScreen = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: authError } = isSignUp 
      ? await signUp(email, password)
      : await signIn(email, password);

    if (authError) {
      setError(authError.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: '#1C2127' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex flex-col items-center gap-4">
            <Logo size={100} />
            <AppName size="lg" light />
          </div>
          <p className="mt-4" style={{ color: '#8B9098' }}>Discover Hoboken's best</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none"
            style={{ backgroundColor: '#2A2F36', border: '1px solid #3A3F46', color: '#E8D4B8' }}
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none"
            style={{ backgroundColor: '#2A2F36', border: '1px solid #3A3F46', color: '#E8D4B8' }}
            required
            minLength={6}
          />

          {error && (
            <p className="text-sm text-center" style={{ color: '#f44336' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl font-medium transition-all"
            style={{ backgroundColor: '#D4B896', color: '#1C2127' }}
          >
            {loading ? 'Loading...' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm" style={{ color: '#8B9098' }}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button onClick={() => setIsSignUp(!isSignUp)} className="underline" style={{ color: '#D4B896' }}>
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  );
};

// ============================================================================
// ONBOARDING COMPONENTS
// ============================================================================

const CUISINE_LIST = [
  { key: 'italian', label: 'Italian', emoji: '🍝' },
  { key: 'pizza', label: 'Pizza', emoji: '🍕' },
  { key: 'american', label: 'American', emoji: '🍔' },
  { key: 'mexican', label: 'Mexican', emoji: '🌮' },
  { key: 'cuban', label: 'Cuban', emoji: '🇨🇺' },
  { key: 'latin', label: 'Latin', emoji: '🌶️' },
  { key: 'japanese', label: 'Japanese', emoji: '🍣' },
  { key: 'chinese', label: 'Chinese', emoji: '🥡' },
  { key: 'thai', label: 'Thai', emoji: '🍜' },
  { key: 'indian', label: 'Indian', emoji: '🍛' },
  { key: 'french', label: 'French', emoji: '🥐' },
  { key: 'german', label: 'German', emoji: '🍺' },
  { key: 'seafood', label: 'Seafood', emoji: '🦞' },
  { key: 'steakhouse', label: 'Steakhouse', emoji: '🥩' },
  { key: 'deli', label: 'Deli', emoji: '🥪' },
  { key: 'vegetarian', label: 'Vegetarian', emoji: '🥗' },
  { key: 'middleeastern', label: 'Middle Eastern', emoji: '🧆' },
  { key: 'mediterranean', label: 'Mediterranean', emoji: '🫒' },
  { key: 'cafe', label: 'Cafe/Coffee', emoji: '☕' },
  { key: 'bakery', label: 'Bakery', emoji: '🥐' },
];

const PreferencesStep = ({ onNext, savePreferences }) => {
  const [rankings, setRankings] = useState([]);
  
  const categories = [
    { key: 'food', label: 'Food Quality', desc: 'Exceptional cuisine and flavors', icon: '🍽️' },
    { key: 'service', label: 'Service', desc: 'Attentive, professional staff', icon: '👤' },
    { key: 'vibe', label: 'Atmosphere', desc: 'Ambiance and setting', icon: '✨' },
    { key: 'value', label: 'Value', desc: 'Worth the price', icon: '💰' },
  ];
  
  const unranked = categories.filter(c => !rankings.includes(c.key));
  const isComplete = rankings.length === categories.length;
  
  const handleSelect = (key) => {
    if (!rankings.includes(key)) {
      setRankings([...rankings, key]);
    }
  };
  
  const handleRemove = (key) => {
    setRankings(rankings.filter(k => k !== key));
  };

  const handleNext = async () => {
    const prefs = {};
    rankings.forEach((k, idx) => { prefs[k] = 5 - idx; });
    await savePreferences(prefs);
    onNext();
  };
  
  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-2xl font-light mb-2" style={{ color: '#4A3728', fontFamily: 'Palatino, Georgia, serif' }}>What matters most?</h2>
        <p style={{ color: '#8B7355' }}>Tap to rank from most to least important</p>
      </div>
      
      <div className="mb-4">
        <p className="text-xs uppercase tracking-wider mb-2" style={{ color: '#8B7355' }}>Your ranking</p>
        <div className="space-y-2">
          {rankings.length === 0 ? (
            <div className="rounded-xl p-4 border-2 border-dashed text-center" style={{ borderColor: '#D4C4B0' }}>
              <p className="text-sm" style={{ color: '#B8A898' }}>Tap items below to rank them</p>
            </div>
          ) : (
            rankings.map((key, idx) => {
              const cat = categories.find(c => c.key === key);
              return (
                <div key={key} className="rounded-xl p-4 border flex items-center justify-between" style={{ backgroundColor: '#FFFCF8', borderColor: '#C4956A' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm" style={{ backgroundColor: '#C4956A', color: '#FFFCF8' }}>{idx + 1}</div>
                    <span className="text-xl">{cat.icon}</span>
                    <p className="font-medium" style={{ color: '#4A3728' }}>{cat.label}</p>
                  </div>
                  <button onClick={() => handleRemove(key)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: '#F5EFE6', color: '#8B7355' }}>✕</button>
                </div>
              );
            })
          )}
        </div>
      </div>
      
      {unranked.length > 0 && (
        <div className="mb-6">
          <div className="grid grid-cols-2 gap-2">
            {unranked.map(({ key, label, icon }) => (
              <button key={key} onClick={() => handleSelect(key)} className="rounded-xl p-4 border text-left" style={{ backgroundColor: '#FFFCF8', borderColor: '#E8DFD4' }}>
                <span className="text-xl mr-2">{icon}</span>
                <span className="font-medium" style={{ color: '#4A3728' }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      
      <button onClick={handleNext} disabled={!isComplete} className="w-full py-4 rounded-xl font-medium" style={{ backgroundColor: isComplete ? '#6B5744' : '#D4C4B0', color: isComplete ? '#FFFCF8' : '#A89888', cursor: isComplete ? 'pointer' : 'not-allowed' }}>Continue</button>
    </div>
  );
};

const CuisinesStep = ({ onNext, onBack, saveCuisinePrefs }) => {
  const [cuisinePrefs, setLocalCuisinePrefs] = useState({});
  
  const SENTIMENT_OPTIONS = [
    { value: 2, label: 'Love', color: '#4CAF50' },
    { value: 1, label: 'Like', color: '#8BC34A' },
    { value: 0, label: 'Neutral', color: '#D4C4B0' },
    { value: -1, label: 'Dislike', color: '#FF9800' },
    { value: -2, label: 'Avoid', color: '#f44336' },
  ];
  
  const allRated = CUISINE_LIST.every(c => cuisinePrefs[c.key] !== undefined);

  const handleNext = async () => {
    await saveCuisinePrefs(cuisinePrefs);
    onNext();
  };
  
  return (
    <div>
      <div className="text-center mb-4">
        <h2 className="text-2xl font-light mb-2" style={{ color: '#4A3728', fontFamily: 'Palatino, Georgia, serif' }}>How do you feel about these cuisines?</h2>
      </div>
      
      <div className="flex justify-center gap-2 mb-4 flex-wrap">
        {SENTIMENT_OPTIONS.map(({ label, color }) => (
          <span key={label} className="text-xs px-2 py-1 rounded" style={{ backgroundColor: color, color: label === 'Neutral' ? '#6B5744' : '#fff' }}>{label}</span>
        ))}
      </div>
      
      <div className="space-y-2 mb-6" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
        {CUISINE_LIST.map(({ key, label, emoji }) => (
          <div key={key} className="rounded-lg p-3 border" style={{ backgroundColor: '#FFFCF8', borderColor: '#E8DFD4' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>{emoji}</span>
                <span className="font-medium" style={{ color: '#4A3728' }}>{label}</span>
              </div>
              <div className="flex gap-1">
                {SENTIMENT_OPTIONS.map(({ value, label: optLabel, color }) => (
                  <button
                    key={value}
                    onClick={() => setLocalCuisinePrefs({ ...cuisinePrefs, [key]: value })}
                    className="px-2 py-1 rounded text-xs font-medium"
                    style={{
                      backgroundColor: cuisinePrefs[key] === value ? color : '#F5EFE6',
                      color: cuisinePrefs[key] === value ? (value === 0 ? '#6B5744' : '#fff') : '#8B7355',
                    }}
                  >
                    {optLabel}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 py-4 rounded-xl font-medium" style={{ backgroundColor: '#F5EFE6', color: '#6B5744' }}>Back</button>
        <button onClick={handleNext} disabled={!allRated} className="flex-1 py-4 rounded-xl font-medium" style={{ backgroundColor: allRated ? '#6B5744' : '#D4C4B0', color: allRated ? '#FFFCF8' : '#A89888', cursor: allRated ? 'pointer' : 'not-allowed' }}>Continue</button>
      </div>
    </div>
  );
};

// ============================================================================
// RESTAURANT CARD
// ============================================================================

const RestaurantCard = ({ restaurant, prediction, userRating, onRate, preferences }) => {
  const [expanded, setExpanded] = useState(false);
  const [tempRating, setTempRating] = useState(userRating || {});
  const [saving, setSaving] = useState(false);
  
  const userOverall = userRating?.overall || (userRating ? CollaborativeFilter.getOverallScore(userRating, preferences) : null);
  
  const handleSave = async () => {
    setSaving(true);
    await onRate(restaurant.id, tempRating);
    setSaving(false);
    setExpanded(false);
  };
  
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: '#FFFCF8', borderColor: '#E8DFD4' }}>
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0" style={{ backgroundColor: '#F5EFE6' }}>{restaurant.image}</div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium truncate" style={{ color: '#4A3728' }}>{restaurant.name}</h3>
            <p className="text-sm" style={{ color: '#8B7355' }}>{restaurant.cuisine}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <CategoryBadge diningStyle={restaurant.dining_style} priceTier={restaurant.price_tier} />
              <span className="text-xs" style={{ color: '#B8A898' }}>{restaurant.neighborhood}</span>
            </div>
          </div>
          
          <div className="text-right flex-shrink-0">
            {userOverall ? (
              <div>
                <div className="text-2xl font-light" style={{ color: '#4A3728' }}>{userOverall.toFixed(1)}</div>
                <div className="text-xs font-medium" style={{ color: '#2E7D32' }}>Your Rating</div>
              </div>
            ) : prediction ? (
              <div>
                <div className="text-2xl font-light" style={{ color: '#C4956A' }}>{prediction.toFixed(1)}</div>
                <div className="text-xs" style={{ color: '#8B7355' }}>For You</div>
              </div>
            ) : (
              <div>
                <div className="text-2xl font-light" style={{ color: '#D4C4B0' }}>{restaurant.baseline_rating?.toFixed(1)}</div>
                <div className="text-xs" style={{ color: '#B8A898' }}>Avg</div>
              </div>
            )}
          </div>
        </div>
        
        <p className="text-xs mt-2" style={{ color: '#B8A898' }}>{restaurant.address}</p>
        
        {userRating?.notes && (
          <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: '#F5EFE6' }}>
            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: '#8B7355' }}>Your Notes</p>
            <p className="text-sm" style={{ color: '#4A3728' }}>{userRating.notes}</p>
          </div>
        )}
        
        <button onClick={() => setExpanded(!expanded)} className="mt-4 w-full py-2 text-sm font-medium" style={{ color: '#6B5744' }}>
          {expanded ? 'Close' : userRating ? 'Edit Rating' : 'Rate This Restaurant'}
        </button>
      </div>
      
      {expanded && (
        <div className="border-t p-5" style={{ backgroundColor: '#F5EFE6', borderColor: '#E8DFD4' }}>
          <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: '#FFFCF8' }}>
            <StarRating value={tempRating.overall || 0} onChange={(v) => setTempRating({...tempRating, overall: v})} size="md" label="Overall Rating" />
          </div>
          
          <p className="text-xs uppercase tracking-wider mb-2" style={{ color: '#8B7355' }}>Detailed (optional)</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {['food', 'service', 'vibe', 'value'].map(key => (
              <StarRating key={key} value={tempRating[key] || 0} onChange={(v) => setTempRating({...tempRating, [key]: v})} size="sm" label={key.charAt(0).toUpperCase() + key.slice(1)} />
            ))}
          </div>
          
          <div className="mb-4">
            <label className="text-xs uppercase tracking-wider mb-2 block" style={{ color: '#8B7355' }}>Your Notes</label>
            <textarea
              value={tempRating.notes || ''}
              onChange={(e) => setTempRating({...tempRating, notes: e.target.value})}
              placeholder="What did you think?"
              className="w-full p-3 rounded-lg text-sm resize-none focus:outline-none"
              style={{ backgroundColor: '#FFFCF8', border: '1px solid #E8DFD4', color: '#4A3728', minHeight: '80px' }}
            />
          </div>
          
          <button
            onClick={handleSave}
            disabled={!tempRating.overall || saving}
            className="w-full py-3 rounded-xl text-sm font-medium"
            style={{ backgroundColor: tempRating.overall ? '#6B5744' : '#D4C4B0', color: tempRating.overall ? '#FFFCF8' : '#A89888' }}
          >
            {saving ? 'Saving...' : 'Save Rating'}
          </button>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN APP
// ============================================================================

const MainApp = () => {
  const { user, signOut } = useAuth();
  const { restaurants, loading: restaurantsLoading } = useRestaurants();
  const { preferences, cuisinePrefs, loading: prefsLoading, savePreferences, saveCuisinePrefs } = useUserPreferences(user?.id);
  const { userRatings, allRatings, loading: ratingsLoading, saveRating } = useRatings(user?.id);
  
  const [screen, setScreen] = useState('loading');
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!prefsLoading && !ratingsLoading && !restaurantsLoading) {
      if (!preferences) {
        setScreen('onboarding');
      } else {
        setScreen('home');
      }
    }
  }, [prefsLoading, ratingsLoading, restaurantsLoading, preferences]);

  const ratedCount = Object.keys(userRatings).length;

  const filteredRestaurants = useMemo(() => {
    let list = restaurants.map(restaurant => {
      const userRating = userRatings[restaurant.id];
      let prediction = null;
      
      if (!userRating) {
        prediction = CollaborativeFilter.predictRating(
          restaurant, user?.id, userRatings, allRatings, preferences, cuisinePrefs
        );
      }
      
      return { restaurant, prediction, userRating };
    });
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(({ restaurant }) => 
        restaurant.name.toLowerCase().includes(q) || 
        restaurant.cuisine.toLowerCase().includes(q) ||
        restaurant.neighborhood?.toLowerCase().includes(q)
      );
    }
    
    if (filter === 'rated') {
      list = list.filter(({ userRating }) => userRating);
    } else if (filter === 'unrated') {
      list = list.filter(({ userRating }) => !userRating);
    }
    
    return list.sort((a, b) => {
      if (a.userRating && !b.userRating) return -1;
      if (!a.userRating && b.userRating) return 1;
      const scoreA = a.userRating ? CollaborativeFilter.getOverallScore(a.userRating, preferences) : a.prediction || 0;
      const scoreB = b.userRating ? CollaborativeFilter.getOverallScore(b.userRating, preferences) : b.prediction || 0;
      return scoreB - scoreA;
    });
  }, [restaurants, userRatings, allRatings, preferences, cuisinePrefs, filter, searchQuery, user?.id]);

  if (screen === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FAF7F2' }}>
        <div className="text-center">
          <Logo size={80} />
          <p className="mt-4" style={{ color: '#8B7355' }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (screen === 'onboarding') {
    return (
      <div className="min-h-screen p-6" style={{ backgroundColor: '#FAF7F2' }}>
        <div className="max-w-md mx-auto pt-8">
          <div className="flex items-center gap-3 mb-8">
            <Logo size={40} />
            <AppName size="sm" />
          </div>
          
          <div className="flex gap-2 mb-8">
            {[1, 2].map(step => (
              <div key={step} className="flex-1 h-1 rounded-full" style={{ backgroundColor: onboardingStep >= step ? '#C4956A' : '#E8DFD4' }} />
            ))}
          </div>
          
          {onboardingStep === 1 && (
            <PreferencesStep 
              onNext={() => setOnboardingStep(2)} 
              savePreferences={savePreferences}
            />
          )}
          {onboardingStep === 2 && (
            <CuisinesStep 
              onNext={() => setScreen('home')} 
              onBack={() => setOnboardingStep(1)}
              saveCuisinePrefs={saveCuisinePrefs}
            />
          )}
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAF7F2' }}>
      <header className="border-b sticky top-0 z-10" style={{ backgroundColor: '#FFFCF8', borderColor: '#E8DFD4' }}>
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Logo size={40} />
              <div>
                <AppName size="sm" />
                <p className="text-xs" style={{ color: '#8B7355' }}>Hoboken, NJ</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-sm font-medium" style={{ color: '#4A3728' }}>{ratedCount} rated</div>
                <div className="text-xs" style={{ color: '#8B7355' }}>{restaurants.length} total</div>
              </div>
              <button onClick={signOut} className="text-xs px-3 py-1 rounded-full" style={{ backgroundColor: '#F5EFE6', color: '#8B7355' }}>
                Sign Out
              </button>
            </div>
          </div>
          
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search restaurants..."
            className="w-full px-4 py-2 rounded-lg text-sm focus:outline-none mb-3"
            style={{ backgroundColor: '#F5EFE6', border: '1px solid #E8DFD4', color: '#4A3728' }}
          />
          
          <div className="flex gap-2">
            {[{ key: 'all', label: 'All' }, { key: 'unrated', label: 'Not Rated' }, { key: 'rated', label: 'Rated' }].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className="px-3 py-1.5 rounded-full text-sm font-medium"
                style={{ backgroundColor: filter === key ? '#6B5744' : '#F5EFE6', color: filter === key ? '#FFFCF8' : '#8B7355' }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>
      
      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="space-y-4">
          {filteredRestaurants.map(({ restaurant, prediction, userRating }) => (
            <RestaurantCard
              key={restaurant.id}
              restaurant={restaurant}
              prediction={prediction}
              userRating={userRating}
              onRate={saveRating}
              preferences={preferences}
            />
          ))}
        </div>
        
        {filteredRestaurants.length === 0 && (
          <div className="text-center py-12">
            <p style={{ color: '#8B7355' }}>No restaurants found</p>
          </div>
        )}
      </main>
    </div>
  );
};

// ============================================================================
// APP ROOT
// ============================================================================

export default function EpicuraApp() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

const AppContent = () => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#1C2127' }}>
        <Logo size={80} />
      </div>
    );
  }
  
  return user ? <MainApp /> : <AuthScreen />;
};
