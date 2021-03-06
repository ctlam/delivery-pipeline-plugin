/*
This file is part of Delivery Pipeline Plugin.

Delivery Pipeline Plugin is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Delivery Pipeline Plugin is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with Delivery Pipeline Plugin.
If not, see <http://www.gnu.org/licenses/>.
*/
package uw.iyyuan.jenkins.timeline.util;

import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Random;

public final class PipelineUtils {
    private static final Random RANDOM = new Random(System.currentTimeMillis());


    private PipelineUtils() {
    }

    /*
     * Converts the timestamp into a Date object. While this is great,
     * it prevents the ability to provide localized timestamps for other users
     * who are in a different timezone relative to the Jenkins server.
     */
    public static String formatTimestamp(long timestamp) {
        DateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
        return format.format(new Date(timestamp));
    }

    /*
     * Convert the timestamp into a string.
     */
    public static String timestampToString(long timestamp) {
        return Long.toString(timestamp);
    }

    public static long getRandom() {
        return RANDOM.nextLong();
    }

}
